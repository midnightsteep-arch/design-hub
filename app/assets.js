// Asset review data layer on top of repo.js (contract §7): "view assets" (manifest entry + review entry +
// optimistic local state), private-repo images as blob URLs, and every review write with toasts, Undo and
// plain-language conflict handling. Writes are queued so two quick clicks never race each other.
import { useEffect, useMemo, useState } from '../vendor/hooks.module.js';
import { STATUS, STATUSES, emptyCounts, plural } from './lib.js';
import { createStore, useStore } from './store.js';
import {
  repoStore, reviewOf, assetById, setAssetStatus, setAssetNotes, attachReplacement, clearReplacement,
  blobUrl, dpath, reloadRepo, transact, reviewPath, fileExists,
} from './repo.js';
import { buildCommitMessage } from './commitmsg.js';
import * as G from './github.js';
import { toast } from './components/toast.js';
import { analyzeImage, pixelChecks } from './pixel.js';

const S = () => repoStore.get();
const me = () => (G.currentUser() || {}).login || 'someone';

// ---------------------------------------------------------------- optimistic local state
// id -> {status?, notes?, localUrl?, text?, uploading?}
export const pendingStore = createStore({ map: {} });
function setPending(id, patch) {
  pendingStore.set((s) => {
    const map = { ...s.map };
    if (patch) map[id] = { ...(map[id] || {}), ...patch }; else delete map[id];
    return { map };
  });
}

// ---------------------------------------------------------------- view assets
const blank = new WeakMap();
function entryFor(a) {
  const r = S().reviews[a.group];
  const e = r && r.data && r.data.assets ? r.data.assets[a.id] : null;
  if (e) return e;
  if (!blank.has(a)) blank.set(a, reviewOf(a));
  return blank.get(a);
}
/** Repo path of a replacement file (stored repo-relative; tolerate design-relative). */
export function replacementRepoPath(rep) {
  if (!rep || !rep.path) return null;
  const p = String(rep.path).replace(/^\/+/, '');
  if (fileExists(p)) return p;
  const d = dpath(p);
  return fileExists(d) ? d : p;
}
/** Repo path of a capture image ({file: "captures/x.png"} is relative to design/assets/). */
export function captureRepoPath(capture) {
  return capture && capture.file ? dpath('assets/' + String(capture.file).replace(/^\/+/, '')) : null;
}
export function captureSidecar(capture) {
  return capture && capture.file ? S().captures[String(capture.file).replace(/^\/+/, '')] || null : null;
}

const viewCache = new WeakMap();
export function toView(a, patch) {
  const e = entryFor(a);
  const c = viewCache.get(a);
  if (c && c.e === e && c.p === patch) return c.v;
  const rep = e.replacement || null;
  const isTextRep = !!(rep && rep.text != null);
  const v = {
    id: a.id, group: a.group, kind: a.kind || 'other', name: a.name || a.id, path: a.path || '', meta: a.meta || {},
    text: a.text != null ? String(a.text) : null, contentHash: a.contentHash || '', sort: a.sort || 0,
    manifest: a, entry: e,
    savedStatus: e.status || 'pending_review',
    status: (patch && patch.status) || e.status || 'pending_review',
    notes: patch && patch.notes != null ? patch.notes : (e.notes || ''),
    replacement: rep,
    replacementPath: rep && !isTextRep ? replacementRepoPath(rep) : null,
    replacementText: patch && patch.text != null ? patch.text : (isTextRep ? String(rep.text) : null),
    localUrl: (patch && patch.localUrl) || null,
    uploading: !!(patch && patch.uploading),
    pending: !!patch,
    capture: e.capture && e.capture.file ? e.capture : null,
    history: Array.isArray(e.history) ? e.history : [],
    archived: !!e.archived,
    // the review entry refers to an older file than the manifest (the game's file changed since)
    stale: !!(e.contentHash && a.contentHash && e.contentHash !== a.contentHash),
  };
  v.hasReplacement = !!(v.localUrl || v.replacementPath || (v.replacementText != null && v.replacementText !== ''));
  viewCache.set(a, { e, p: patch, v });
  return v;
}

const sortAssets = (a, b) => (a.sort || 0) - (b.sort || 0) || String(a.name).localeCompare(String(b.name));

/** All view assets (optionally of one group), sorted; re-renders on any repo load/commit or local change. */
export function useViewAssets(groupId) {
  const assets = useStore(repoStore, (s) => s.assets);
  const reviews = useStore(repoStore, (s) => s.reviews);
  const map = useStore(pendingStore, (s) => s.map);
  return useMemo(() => assets.filter((a) => !groupId || a.group === groupId).map((a) => toView(a, map[a.id])).sort(sortAssets),
    [assets, reviews, map, groupId]);
}
export function useViewAsset(id) {
  const assets = useStore(repoStore, (s) => s.assets);
  useStore(repoStore, (s) => s.reviews);
  const patch = useStore(pendingStore, (s) => s.map[id]);
  const a = assets.find((x) => x.id === id);
  return a ? toView(a, patch) : null;
}
export function useCanEdit() { return useStore(repoStore, (s) => !!s.canPush); }
export function useProject() { return useStore(repoStore, (s) => (s.hub && s.hub.project) || EMPTY); }
const EMPTY = {};
export function projectNow() { const h = S().hub; return (h && h.project) || EMPTY; }

export function countStatuses(list) {
  const c = emptyCounts();
  for (const a of list || []) if (c[a.status] != null) c[a.status]++;
  return c;
}
export function assetDims(a) {
  const m = (a && a.meta) || {};
  return m.w && m.h ? { w: Number(m.w), h: Number(m.h) } : null;
}
export function matchesQuery(a, q) {
  if (!q) return true;
  const s = q.toLowerCase();
  const has = (x) => x != null && String(x).toLowerCase().includes(s);
  return has(a.name) || has(a.path) || has(a.id) || has(a.text) || has(a.notes) || has(a.replacementText) || has(a.meta && a.meta.key) || has(a.meta && a.meta.context);
}
/** Who/when of the latest review event (for the "Updated" column). */
export function lastEvent(a) {
  const h = a.history[a.history.length - 1];
  const cands = [];
  if (h && h.at) cands.push({ at: Date.parse(h.at), by: h.by, status: h.status });
  if (a.replacement && a.replacement.at) cands.push({ at: Date.parse(a.replacement.at), by: a.replacement.by });
  cands.sort((x, y) => y.at - x.at);
  return cands[0] || null;
}

// ---------------------------------------------------------------- images (private repo → blob: URLs)
const primed = new Map();   // repo path -> local object URL (a file we just uploaded; avoids a refetch flash)
const resolved = new Map(); // "path|sha" -> blob URL
/** {src, loading, error} for a repo file shown as an image (blob: URL, cached by content). */
export function useRepoImage(path) {
  const sha = useStore(repoStore, (s) => (path && s.files && s.files.get(path) ? s.files.get(path).sha : null));
  const key = path ? path + '|' + sha : '';
  const initial = () => {
    if (!path) return { src: null, loading: false, error: null };
    if (resolved.has(key)) return { src: resolved.get(key), loading: false, error: null };
    if (primed.has(path)) return { src: primed.get(path), loading: false, error: null };
    return { src: null, loading: !!sha, error: sha ? null : 'missing' };
  };
  const [st, setSt] = useState(initial);
  useEffect(() => {
    const now = initial();
    setSt(now);
    if (!path || !sha || resolved.has(key) || primed.has(path)) return undefined;
    let alive = true;
    blobUrl(path).then((u) => {
      if (u) resolved.set(key, u);
      if (alive) setSt({ src: u || null, loading: false, error: u ? null : 'missing' });
    }).catch((e) => { if (alive) setSt({ src: null, loading: false, error: e }); });
    return () => { alive = false; };
  }, [key]);
  return st;
}

// ---------------------------------------------------------------- writes
let chain = Promise.resolve();
function queued(fn) {
  const p = chain.then(fn, fn);
  chain = p.catch(() => {});
  return p;
}
export const statusLabel = (s) => (STATUS[s] ? STATUS[s].label : String(s || '').replace(/_/g, ' '));
const nameOf = (id) => { const a = assetById(id); return a ? a.name || a.id : id; };

function conflictToast(id, current) {
  const h = current && Array.isArray(current.history) ? current.history[current.history.length - 1] : null;
  const who = h && h.by && h.by !== me() && h.status === current.status ? h.by : 'Someone';
  toast(`${who} changed ${nameOf(id)} to ${statusLabel(current && current.status)} a moment ago.`, {
    kind: 'error', duration: 12000, detail: 'Nothing was overwritten. The list now shows their change — take another look before deciding.',
  });
  reloadRepo().catch(() => {});
}
function failToast(what, e) {
  toast(`Couldn't ${what}`, { kind: 'error', detail: (e && e.message) || String(e) });
}

/** Change an asset's status (a human decision by the signed-in user). */
export function changeStatus(id, to, { note = '', quiet = false, undo = true } = {}) {
  const a = assetById(id);
  if (!a) return Promise.resolve({ status: 'error' });
  const from = toView(a, null).savedStatus;
  if (from === to && !note) return Promise.resolve({ status: 'nothing' });
  setPending(id, { status: to });
  return queued(async () => {
    try {
      const r = await setAssetStatus(id, to, { from, note });
      setPending(id, null);
      if (r.status === 'conflict') { conflictToast(id, r.current); return r; }
      if (!quiet) {
        toast(`${nameOf(id)}: ${statusLabel(to)}`, {
          kind: 'success',
          action: undo ? { label: 'Undo', icon: 'undo', run: () => changeStatus(id, from, { quiet: true, undo: false }).then((x) => { if (x && x.status === 'saved') toast('Reverted', { kind: 'info', duration: 1800 }); }) } : null,
        });
      }
      return r;
    } catch (e) {
      setPending(id, null);
      failToast(`change the status of ${nameOf(id)}`, e);
      return { status: 'error', error: e };
    }
  });
}

export function saveNotes(id, text) {
  const a = assetById(id);
  if (!a) return Promise.resolve({ status: 'error' });
  const t = String(text || '').replace(/\r\n/g, '\n').trim();
  if (t === (toView(a, null).notes || '')) return Promise.resolve({ status: 'nothing' });
  setPending(id, { notes: t });
  return queued(async () => {
    try {
      const r = await setAssetNotes(id, t);
      setPending(id, null);
      if (r.status === 'conflict') { conflictToast(id, r.current); return r; }
      toast(`Notes saved for ${nameOf(id)}`, { kind: 'success', duration: 2200 });
      return r;
    } catch (e) {
      setPending(id, null);
      failToast(`save the notes for ${nameOf(id)}`, e);
      return { status: 'error', error: e };
    }
  });
}

const IMG_EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };
export function imageExt(file) {
  const m = /\.([a-z0-9]+)$/i.exec((file && file.name) || '');
  const e = m ? m[1].toLowerCase() : '';
  if (['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(e)) return e === 'jpeg' ? 'jpg' : e;
  return IMG_EXT[(file && file.type) || ''] || null;
}

/** Attach a replacement from a File (an image, or a .txt for text assets). Sets status Replaced. */
export async function attachFile(id, file) {
  const a = assetById(id);
  if (!a || !file) return null;
  if (a.kind === 'text') {
    if (/^text\//.test(file.type || '') || /\.(txt|md)$/i.test(file.name || '')) {
      const text = (await file.text()).replace(/\r\n/g, '\n').replace(/\n$/, '');
      return attachText(id, text);
    }
    toast('This is a text asset — drop a .txt file or type the new text.', { kind: 'error' });
    return null;
  }
  const ext = imageExt(file);
  if (!ext) { toast(`That isn't a PNG, JPG, WebP or GIF image (${file.type || file.name || 'unknown type'}).`, { kind: 'error' }); return null; }
  if (file.size > 25 * 1024 * 1024) { toast('That file is larger than 25 MB.', { kind: 'error' }); return null; }
  const localUrl = URL.createObjectURL(file);
  const before = toView(a, null);
  setPending(id, { localUrl, uploading: true, status: 'replaced' });
  return queued(async () => {
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const r = await attachReplacement(id, { bytes, ext });
      if (r.status === 'conflict') { setPending(id, null); URL.revokeObjectURL(localUrl); conflictToast(id, r.current); return r; }
      const after = toView(assetById(id) || a, null);
      if (after.replacementPath) primed.set(after.replacementPath, localUrl);
      setPending(id, null);
      // pixel-art checks warn but never block
      let detail;
      try {
        const res = await analyzeImage(localUrl);
        const settings = (projectNow().settings || {}).pixelArt;
        const bad = pixelChecks(res, { settings, currentDims: assetDims(after) }).filter((c) => !c.ok);
        if (bad.length) detail = 'Pixel checks: ' + bad.map((c) => c.label).join(' · ');
      } catch (e) { /* best effort */ }
      toast(`${nameOf(id)}: replacement attached — marked Replaced`, {
        kind: 'success', detail, action: { label: 'Undo', icon: 'undo', run: () => undoReplacement(id, before) },
      });
      return r;
    } catch (e) {
      setPending(id, null);
      URL.revokeObjectURL(localUrl);
      failToast(`attach the replacement for ${nameOf(id)}`, e);
      return { status: 'error', error: e };
    }
  });
}

export function attachText(id, text) {
  const a = assetById(id);
  if (!a) return Promise.resolve(null);
  const t = String(text == null ? '' : text).replace(/\r\n/g, '\n').replace(/\s+$/, '');
  const before = toView(a, null);
  if (t === (before.replacementText || '')) return Promise.resolve({ status: 'nothing' });
  if (!t) return removeReplacement(id);
  setPending(id, { text: t, status: 'replaced' });
  return queued(async () => {
    try {
      const r = await attachReplacement(id, { text: t });
      setPending(id, null);
      if (r.status === 'conflict') { conflictToast(id, r.current); return r; }
      toast(`${nameOf(id)}: replacement text saved — marked Replaced`, {
        kind: 'success', action: { label: 'Undo', icon: 'undo', run: () => undoReplacement(id, before) },
      });
      return r;
    } catch (e) {
      setPending(id, null);
      failToast(`save the replacement text for ${nameOf(id)}`, e);
      return { status: 'error', error: e };
    }
  });
}

/** Remove the replacement (the file stays in the repo's history); status back to Needs Replacement. */
export function removeReplacement(id, { quiet = false } = {}) {
  const a = assetById(id);
  if (!a) return Promise.resolve(null);
  const before = toView(a, null);
  if (!before.replacement) return Promise.resolve({ status: 'nothing' });
  setPending(id, { status: 'needs_replacement', text: '' });
  return queued(async () => {
    try {
      const r = await clearReplacement(id);
      setPending(id, null);
      if (r.status === 'conflict') { conflictToast(id, r.current); return r; }
      if (!quiet) toast(`${nameOf(id)}: replacement removed — back to Needs Replacement`, { kind: 'info', action: { label: 'Undo', icon: 'undo', run: () => undoReplacement(id, before) } });
      return r;
    } catch (e) {
      setPending(id, null);
      failToast(`remove the replacement for ${nameOf(id)}`, e);
      return { status: 'error', error: e };
    }
  });
}

// Undo = restore the previous replacement and status in one change (old files are still in the repo).
function undoReplacement(id, before) {
  const a = assetById(id);
  if (!a) return Promise.resolve();
  setPending(id, { status: before.savedStatus });
  return queued(async () => {
    const path = reviewPath(a.group);
    try {
      await transact(async (ctx) => {
        const data = (await ctx.json(path)) || { group: a.group, assets: {} };
        data.assets = data.assets || {};
        const cur = JSON.parse(JSON.stringify(data.assets[id] || before.entry));
        const from = cur.status || 'pending_review';
        cur.replacement = before.replacement ? JSON.parse(JSON.stringify(before.replacement)) : null;
        cur.status = before.savedStatus;
        cur.history = cur.history || [];
        cur.history.push({ at: new Date().toISOString(), by: me(), status: cur.status, contentHash: cur.contentHash || a.contentHash || '', note: 'Undo: previous replacement restored' });
        data.assets[id] = cur;
        return { files: [{ path, text: JSON.stringify(data, null, 2) + '\n' }],
          message: buildCommitMessage({ summary: `Undo replacement change for ${a.name || id}`, assets: [{ group: a.group, id, from, to: cur.status }] }) };
      });
      setPending(id, null);
      toast('Reverted', { kind: 'info', duration: 1800 });
    } catch (e) {
      setPending(id, null);
      failToast(`undo the change to ${a.name || id}`, e);
    }
  });
}

/**
 * Bulk status change as ONE change (commit) covering every selected asset whose status is still what the
 * user saw. Assets someone else changed meanwhile are skipped and reported (never overwritten).
 */
export function bulkStatus(items, to) {
  const eligible = items.filter((a) => a.savedStatus !== to && (to !== 'replaced' || a.hasReplacement));
  if (!eligible.length) {
    toast(to === 'replaced' ? 'None of the selected assets have a replacement attached.' : `All selected assets are already ${statusLabel(to)}.`, { kind: 'info' });
    return Promise.resolve(null);
  }
  for (const a of eligible) setPending(a.id, { status: to });
  return queued(async () => {
    let skipped = [], changed = [];
    try {
      const res = await transact(async (ctx) => {
        skipped = []; changed = [];
        const byGroup = new Map();
        for (const a of eligible) { if (!byGroup.has(a.group)) byGroup.set(a.group, []); byGroup.get(a.group).push(a); }
        const files = [], lines = [];
        const at = new Date().toISOString();
        for (const [gid, list] of byGroup) {
          const path = reviewPath(gid);
          const data = (await ctx.json(path)) || { group: gid, assets: {} };
          data.assets = data.assets || {};
          let n = 0;
          for (const a of list) {
            const cur = JSON.parse(JSON.stringify(data.assets[a.id] || reviewOf(a.manifest)));
            if ((cur.status || 'pending_review') !== a.savedStatus) { skipped.push({ a, current: cur }); continue; }
            cur.history = cur.history || [];
            cur.history.push({ at, by: me(), status: to, contentHash: cur.contentHash || a.contentHash || '', note: '' });
            cur.status = to;
            data.assets[a.id] = cur;
            lines.push({ group: gid, id: a.id, from: a.savedStatus, to });
            changed.push(a);
            n++;
          }
          if (n) files.push({ path, text: JSON.stringify(data, null, 2) + '\n' });
        }
        if (!files.length) return null;
        return { files, message: buildCommitMessage({ summary: `Review ${plural(lines.length, 'asset')}: ${to.replace(/_/g, ' ')}`, assets: lines }) };
      });
      for (const a of eligible) setPending(a.id, null);
      if (skipped.length) reloadRepo().catch(() => {});
      const nOk = res && !res.skipped ? changed.length : 0;
      toast(nOk ? `${plural(nOk, 'asset')} → ${statusLabel(to)}` : 'Nothing changed', {
        kind: nOk ? 'success' : 'info',
        detail: skipped.length ? `${skipped.length} skipped — someone changed ${skipped.slice(0, 3).map((x) => `${x.a.name} (now ${statusLabel(x.current.status)})`).join(', ')}${skipped.length > 3 ? '…' : ''} a moment ago.` : undefined,
        duration: skipped.length ? 12000 : undefined,
      });
      return { changed, skipped };
    } catch (e) {
      for (const a of eligible) setPending(a.id, null);
      failToast('change the status of the selected assets', e);
      return null;
    }
  });
}

export { STATUSES };
