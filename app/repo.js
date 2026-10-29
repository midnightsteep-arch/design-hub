// Repo store: everything the app knows about the open game repo, loaded through the GitHub layer,
// plus every write the app makes (pages, tuning cells, asset review), each one atomic commit with the
// §8 concurrency handling. Views read state with useStore(repoStore, sel) and call the functions below.
import { createStore } from './store.js';
import * as G from './github.js';
import { canon, defaultCanon, validateCanon, displayText } from './canon.js';
import { serializeTable, parseTable, reapplyChanges, cellCanon } from './tablefile.js';
import { buildCommitMessage, tuneSummary } from './commitmsg.js';
import { merge3 } from './merge3.js';

export const repoStore = createStore({
  key: null,            // "owner/repo"
  owner: null, repo: null,
  status: 'idle',       // idle | loading | ready | nohub | error
  error: null,
  info: null,           // GET /repos response
  canPush: false,
  branch: null,
  head: null,           // commit sha the app shows
  remoteHead: null,     // latest sha seen by polling
  newCommits: 0,        // commits on the branch since `head`
  files: null,          // Map path -> {sha,size} at head
  designRoot: 'design',
  hub: null,            // design/hub.json
  schema: null,         // design/tuning/schema.json (null if none)
  tables: {},           // tableId -> {rows, sha, path}
  views: {},            // viewId -> view json
  groups: [],           // asset groups from all manifests (+ tab)
  assets: [],           // assets from manifests, with .review merged in (see assetsWithReview)
  reviews: {},          // groupId -> {data, sha, path}
  captures: {},         // "captures/x.png" -> sidecar json
  pages: [],            // flat [{id,title,file,tabId,tabTitle}]
  loadedAt: 0,
  version: 0,           // bumps on every successful load/commit
});
const S = () => repoStore.get();

export const dpath = (rel) => (S().designRoot || 'design').replace(/\/+$/, '') + '/' + String(rel).replace(/^\/+/, '');
const utf8 = new TextEncoder();
export const sha256Hex = async (bytes) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');

// ------------------------------------------------------------- reading at a commit
const treeByCommit = new Map();
async function filesAt(commitSha) {
  if (treeByCommit.has(commitSha)) return treeByCommit.get(commitSha);
  const { owner, repo } = S();
  const c = await G.getGitCommit(owner, repo, commitSha);
  const t = await G.getTree(owner, repo, c.tree.sha);
  treeByCommit.set(commitSha, t.files);
  return t.files;
}
async function bytesAt(files, commitSha, path) {
  const f = files.get(path);
  if (!f) return null;
  const { owner, repo } = S();
  const r = await G.readFile(owner, repo, path, commitSha, f.sha);
  return r ? r.bytes : null;
}
async function textAt(files, commitSha, path) {
  const b = await bytesAt(files, commitSha, path);
  return b == null ? null : G.bytesToText(b);
}
async function jsonAt(files, commitSha, path) {
  const t = await textAt(files, commitSha, path);
  if (t == null) return null;
  try { return JSON.parse(t); } catch (e) { throw new Error(`${path} is not valid JSON (${e.message})`); }
}

/** Read a file at the shown head (text). */
export async function readText(path) { const s = S(); return textAt(s.files, s.head, path); }
export async function readBytes(path) { const s = S(); return bytesAt(s.files, s.head, path); }
export function fileSha(path) { const f = S().files && S().files.get(path); return f ? f.sha : null; }
export function fileExists(path) { return !!(S().files && S().files.has(path)); }

// private images → blob URLs, cached by blob sha
const urlBySha = new Map();
const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml' };
export async function blobUrl(path) {
  const sha = fileSha(path);
  if (!sha) return null;
  if (urlBySha.has(sha)) return urlBySha.get(sha);
  const p = (async () => {
    const bytes = await readBytes(path);
    if (!bytes) return null;
    const ext = (path.split('.').pop() || '').toLowerCase();
    return URL.createObjectURL(new Blob([bytes], { type: MIME[ext] || 'application/octet-stream' }));
  })();
  urlBySha.set(sha, p);
  p.catch(() => urlBySha.delete(sha));
  return p;
}

// ------------------------------------------------------------- load
let loadSeq = 0;
export async function openRepo(owner, repo) {
  const key = owner + '/' + repo;
  if (S().key === key && (S().status === 'ready' || S().status === 'loading')) return;
  const seq = ++loadSeq;
  repoStore.set({ key, owner, repo, status: 'loading', error: null, info: null, head: null, files: null, hub: null, schema: null,
    tables: {}, views: {}, groups: [], assets: [], reviews: {}, captures: {}, pages: [], newCommits: 0, remoteHead: null });
  try {
    const info = await G.getRepo(owner, repo);
    if (seq !== loadSeq) return;
    const canPush = !!(info.permissions && info.permissions.push);
    let branch = info.default_branch || 'main';
    repoStore.set({ info, canPush, branch });
    let head = await G.getHeadSha(owner, repo, branch);
    let files = await filesAt(head);
    // hub.json may name another branch (§2)
    const hubPath = [...files.keys()].find((p) => p === 'design/hub.json') || 'design/hub.json';
    const hub0 = await jsonAt(files, head, hubPath);
    if (hub0 && hub0.branch && hub0.branch !== branch) {
      branch = hub0.branch;
      head = await G.getHeadSha(owner, repo, branch);
      files = await filesAt(head);
      repoStore.set({ branch });
    }
    if (seq !== loadSeq) return;
    await loadAt(head, files, seq);
  } catch (e) {
    if (seq !== loadSeq) return;
    repoStore.set({ status: 'error', error: e });
  }
}

async function loadAt(head, files, seq = loadSeq) {
  files = files || await filesAt(head);
  const designRoot0 = 'design';
  const hub = await jsonAt(files, head, designRoot0 + '/hub.json');
  if (seq !== loadSeq) return;
  if (!hub) { repoStore.set({ status: 'nohub', head, files, remoteHead: head }); return; }
  const designRoot = String(hub.designRoot || 'design').replace(/^\/+|\/+$/g, '');
  const D = (rel) => designRoot + '/' + rel;
  const under = (prefix, ext) => [...files.keys()].filter((p) => p.startsWith(D(prefix)) && p.endsWith(ext) && !p.slice(D(prefix).length).includes('/'));

  const [schema, tablesArr, viewsArr, manifests, reviewsArr, capturesArr] = await Promise.all([
    jsonAt(files, head, D('tuning/schema.json')),
    Promise.all(under('tuning/tables/', '.json').map(async (p) => {
      const text = await textAt(files, head, p);
      try { const t = parseTable(text); return { id: t.table || p.split('/').pop().replace(/\.json$/, ''), rows: t.rows, sha: files.get(p).sha, path: p }; }
      catch (e) { return { id: p.split('/').pop().replace(/\.json$/, ''), rows: [], sha: files.get(p).sha, path: p, error: e.message }; }
    })),
    Promise.all(under('views/', '.json').map(async (p) => { try { return await jsonAt(files, head, p); } catch (e) { return { id: p.split('/').pop().replace(/\.json$/, ''), error: e.message, columns: [], rows: [] }; } })),
    Promise.all(under('assets/manifest/', '.json').map(async (p) => { try { return await jsonAt(files, head, p); } catch (e) { return null; } })),
    Promise.all(under('assets/review/', '.json').map(async (p) => { try { return { data: await jsonAt(files, head, p), sha: files.get(p).sha, path: p }; } catch (e) { return null; } })),
    Promise.all(under('assets/captures/', '.json').map(async (p) => { try { return [p.slice(D('assets/').length).replace(/\.json$/, '.png'), await jsonAt(files, head, p)]; } catch (e) { return null; } })),
  ]);
  if (seq !== loadSeq) return;
  const tables = {};
  for (const t of tablesArr) tables[t.id] = t;
  const views = {};
  for (const v of viewsArr) if (v && v.id) views[v.id] = v;
  const groups = [], assets = [];
  for (const m of manifests.filter(Boolean)) {
    for (const g of m.groups || []) if (!groups.find((x) => x.id === g.id)) groups.push(g);
    for (const a of m.assets || []) assets.push(a);
  }
  groups.sort((a, b) => (a.sort || 0) - (b.sort || 0) || String(a.title).localeCompare(String(b.title)));
  const reviews = {};
  for (const r of reviewsArr.filter(Boolean)) if (r.data && r.data.group) reviews[r.data.group] = r;
  const captures = {};
  for (const c of capturesArr.filter(Boolean)) captures[c[0]] = c[1];
  const pages = [];
  for (const t of hub.tabs || []) for (const p of t.pages || []) pages.push({ ...p, tabId: t.id, tabTitle: t.title, tabIcon: t.icon });
  repoStore.set({ status: 'ready', error: null, head, remoteHead: head, newCommits: 0, files, hub, designRoot, schema, tables, views, groups, assets, reviews, captures, pages, loadedAt: Date.now(), version: S().version + 1 });
}

/** Reload to the branch's latest commit (the "reload — N new changes" button). */
export async function reloadRepo() {
  const s = S();
  if (!s.owner) return;
  const head = await G.getHeadSha(s.owner, s.repo, s.branch);
  await loadAt(head);
}

// ------------------------------------------------------------- polling (§8: every 30 s)
let pollTimer = null;
export function startRepoPolling() {
  if (pollTimer) return;
  pollTimer = setInterval(checkRemote, 30000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkRemote(); });
}
export async function checkRemote() {
  const s = S();
  if (s.status !== 'ready' || document.visibilityState !== 'visible' || !G.isSignedIn()) return;
  try {
    const remote = await G.getHeadSha(s.owner, s.repo, s.branch);
    if (remote === S().head) { if (S().newCommits) repoStore.set({ newCommits: 0, remoteHead: remote }); return; }
    if (remote === S().remoteHead && S().newCommits) return;
    const { commits } = await G.listCommits(s.owner, s.repo, { sha: s.branch, perPage: 50 });
    let n = commits.findIndex((c) => c.sha === S().head);
    if (n < 0) n = commits.length;
    repoStore.set({ remoteHead: remote, newCommits: Math.max(1, n) });
  } catch (e) { /* offline: try again next tick */ }
}

// ------------------------------------------------------------- schema helpers
export function schemaTable(id) { const s = S().schema; return s ? (s.tables || []).find((t) => t.id === id) || null : null; }
export function tableRows(id) { const t = S().tables[id]; return t ? t.rows : []; }
/** Canonical value the app shows for a cell: missing cell → the column's empty default (Tuning Desk §4). */
export function cellValue(tableId, key, colId) {
  const st = schemaTable(tableId);
  const col = st && st.columns.find((c) => c.id === colId);
  const row = tableRows(tableId).find((r) => r.key === key);
  if (!col || !row) return null;
  const raw = row.values[colId];
  if (raw === undefined || raw === null) return defaultCanon(col.type);
  const c = canon(col, raw);
  return c === null ? String(raw) : c;
}
export function rowName(tableId, key) { const r = tableRows(tableId).find((x) => x.key === key); return r ? r.name || key : key; }

// ------------------------------------------------------------- generic write transaction
export class ConflictError extends Error {
  constructor(kind, detail) { super('conflict'); this.kind = kind; this.detail = detail; }
}

/**
 * Run one atomic commit. build(ctx) returns {files, message} (or null to skip); ctx.text/json/bytes read files
 * at ctx.head; ctx.attempt is 0 on the first try. On a stale ref (someone saved at the same moment) the head is
 * re-read and build() runs again, so it must re-derive the files from what it reads (cell-by-cell re-apply).
 */
export async function transact(build) {
  const s = S();
  if (!s.canPush) throw new G.GhError(403, "You have read-only access to this repo. Ask the owner for Write access to make changes.");
  // Start from the branch's real head, not the (possibly older) head the app shows: re-applying
  // onto the latest version on the first try avoids false conflicts after a teammate's save.
  let head = await G.getHeadSha(s.owner, s.repo, s.branch);
  for (let attempt = 0; ; attempt++) {
    const files = await filesAt(head);
    const ctx = {
      head, attempt, files,
      text: (p) => textAt(files, head, p),
      json: (p) => jsonAt(files, head, p),
      bytes: (p) => bytesAt(files, head, p),
      exists: (p) => files.has(p),
      sha: (p) => (files.get(p) || {}).sha || null,
    };
    const plan = await build(ctx);
    if (!plan || !plan.files || !plan.files.length) return { skipped: true };
    try {
      const res = await G.commitFiles(s.owner, s.repo, s.branch, { parentSha: head, files: plan.files, message: plan.message });
      await loadAt(res.sha);
      return { sha: res.sha, rebased: attempt > 0 };
    } catch (e) {
      if (!(e instanceof G.StaleRefError) || attempt >= 4) throw e;
      head = await G.getHeadSha(s.owner, s.repo, s.branch);
    }
  }
}

function me() { const u = G.currentUser(); return u ? u.login : 'someone'; }

// ------------------------------------------------------------- tuning commit (§8)
/**
 * Validate staged changes against the schema (type/min/max/options, canonicalise, reject read-only).
 * changes: [{table, key, column, from, to}] → {ok, changes (canonical), errors:[{…change, error}]}
 */
export function validateChanges(changes) {
  const out = [], errors = [];
  for (const ch of changes) {
    const st = schemaTable(ch.table);
    const col = st && st.columns.find((c) => c.id === ch.column);
    if (!col) { errors.push({ ...ch, error: 'Unknown table or column' }); continue; }
    if (!tableRows(ch.table).some((r) => r.key === ch.key)) { errors.push({ ...ch, error: 'This row no longer exists' }); continue; }
    const v = validateCanon(col, ch.to);
    if (!v.ok) { errors.push({ ...ch, error: v.error }); continue; }
    const from = ch.from == null ? defaultCanon(col.type) : ch.from;
    if (from === v.canon) continue; // no-op
    out.push({ table: ch.table, key: ch.key, column: ch.column, from, to: v.canon });
  }
  return { ok: errors.length === 0, changes: out, errors };
}

/**
 * Commit tuning changes as one commit. Re-applies cell by cell on top of whatever is on the branch now.
 * Returns {status:'saved', sha, rebased} or {status:'conflict', conflicts:[{table,key,column,from,to,current}]}.
 * To resolve: call again with the user's choices (keep mine → from = current; keep theirs → drop the change).
 */
export async function commitTuning(changes, { note = '', source = 'app' } = {}) {
  const v = validateChanges(changes);
  if (!v.ok) throw new Error(v.errors.map((e) => `${e.table} · ${rowName(e.table, e.key)} · ${e.column}: ${e.error}`).join('\n'));
  if (!v.changes.length) return { status: 'nothing' };
  const byTable = new Map();
  for (const c of v.changes) { if (!byTable.has(c.table)) byTable.set(c.table, []); byTable.get(c.table).push(c); }
  try {
    const res = await transact(async (ctx) => {
      const files = [], conflicts = [];
      for (const [tid, list] of byTable) {
        const st = schemaTable(tid);
        const path = dpath(`tuning/tables/${tid}.json`);
        const text = await ctx.text(path);
        if (text == null) throw new Error(`The table file ${path} is missing on the branch. Ask a developer to run the engine sync.`);
        const r = reapplyChanges(parseTable(text), st, list);
        conflicts.push(...r.conflicts);
        if (r.missing.length) conflicts.push(...r.missing.map((m) => ({ ...m, current: null })));
        files.push({ path, text: serializeTable(tid, r.data.rows, st) });
      }
      if (conflicts.length) throw new ConflictError('tuning', conflicts);
      const nameOf = (c) => rowName(c.table, c.key);
      return { files, message: buildCommitMessage({ summary: tuneSummary(v.changes, nameOf), cells: v.changes, note, source }) };
    });
    return { status: 'saved', ...res };
  } catch (e) {
    if (e instanceof ConflictError) return { status: 'conflict', conflicts: e.detail };
    throw e;
  }
}

// ------------------------------------------------------------- pages (§3, §8)
export function pageById(id) { return S().pages.find((p) => p.id === id) || null; }
export function pagePath(page) { return dpath(page.file || `pages/${page.id}.md`); }
/** {text, sha, path} of a page at the shown head ('' when the file doesn't exist yet). */
export async function loadPage(id) {
  const page = pageById(id);
  if (!page) return null;
  const path = pagePath(page);
  const text = await readText(path);
  return { page, path, text: text == null ? '' : text, sha: fileSha(path), missing: text == null };
}

const normText = (t) => { let s = String(t || '').replace(/\r\n/g, '\n'); if (s && !s.endsWith('\n')) s += '\n'; return s; };

/**
 * Save a page edit. base = {text, sha} the user opened. Three-way merges with any newer version.
 * Returns {status:'saved', merged} | {status:'conflict', merge, theirs:{text, sha}}. Resolve by calling again with
 * base = theirs and text = the user's resolved text.
 */
export async function savePage(id, base, text, { note = '' } = {}) {
  const page = pageById(id);
  const path = pagePath(page);
  const mine = normText(text);
  let merged = false;
  try {
    const res = await transact(async (ctx) => {
      const curSha = ctx.sha(path);
      let out = mine;
      if (curSha !== (base.sha || null)) {
        const theirs = (await ctx.text(path)) || '';
        const m = merge3(base.text || '', mine, theirs);
        if (!m.clean) throw new ConflictError('page', { merge: m, theirs: { text: theirs, sha: curSha } });
        out = m.text;
        merged = true;
      }
      if (curSha && out === ((await ctx.text(path)) || '')) return null;
      return { files: [{ path, text: out }], message: buildCommitMessage({ summary: `Edit page ${page.title || id}`, pages: [{ id }], note }) };
    });
    return { status: res.skipped ? 'nothing' : 'saved', merged, ...res };
  } catch (e) {
    if (e instanceof ConflictError) return { status: 'conflict', ...e.detail };
    throw e;
  }
}

// ------------------------------------------------------------- assets (§7)
export const STATUS_KEYS = ['pending_review', 'needs_replacement', 'replaced', 'approved'];
export function safeId(id) { return String(id).replace(/[^A-Za-z0-9._-]/g, '_'); }
export function utcStamp(d = new Date()) { return d.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z'); }
export function reviewPath(groupId) { return dpath(`assets/review/${groupId}.json`); }
const reviewJson = (data) => JSON.stringify(data, null, 2) + '\n';
function blankEntry(asset) { return { status: 'pending_review', contentHash: asset ? asset.contentHash || '' : '', notes: '', replacement: null, capture: null, archived: false, history: [] }; }

/** Review entry for an asset (as on the branch). */
export function reviewOf(asset) {
  const r = S().reviews[asset.group];
  const e = r && r.data && r.data.assets ? r.data.assets[asset.id] : null;
  return e || blankEntry(asset);
}
export function assetById(id) { return S().assets.find((a) => a.id === id) || null; }

/**
 * Change one asset's review entry. mutate(entry, asset) edits a copy and may return extra files [{path, bytes|text}].
 * expect: {status} the user saw — if the entry's status changed meanwhile, ConflictError('asset').
 */
async function commitReview(assetId, { expect, mutate, summary, assetsLine, note }) {
  const asset = assetById(assetId);
  if (!asset) throw new Error('Unknown asset ' + assetId);
  const path = reviewPath(asset.group);
  try {
    const res = await transact(async (ctx) => {
      const data = (await ctx.json(path)) || { group: asset.group, assets: {} };
      data.assets = data.assets || {};
      const cur = data.assets[asset.id] ? JSON.parse(JSON.stringify(data.assets[asset.id])) : blankEntry(asset);
      if (expect && expect.status && cur.status !== expect.status) throw new ConflictError('asset', { current: cur, expected: expect });
      const extra = (await mutate(cur, asset)) || [];
      data.assets[asset.id] = cur;
      return { files: [...extra, { path, text: reviewJson(data) }], message: buildCommitMessage({ summary, assets: assetsLine ? [assetsLine] : [], note }) };
    });
    return { status: 'saved', ...res };
  } catch (e) {
    if (e instanceof ConflictError) return { status: 'conflict', ...e.detail };
    throw e;
  }
}

/** Set an asset's status (humans only set needs_replacement/approved — the signed-in user). */
export function setAssetStatus(assetId, to, { from, note = '' } = {}) {
  const asset = assetById(assetId);
  return commitReview(assetId, {
    expect: from ? { status: from } : null,
    summary: `Review ${asset ? asset.name || asset.id : assetId}: ${to.replace(/_/g, ' ')}`,
    assetsLine: { group: asset.group, id: assetId, from: from || reviewOf(asset).status, to },
    note,
    mutate: (e) => {
      e.history = e.history || [];
      e.history.push({ at: new Date().toISOString(), by: me(), status: to, contentHash: e.contentHash || asset.contentHash || '', note: note || '' });
      e.status = to;
    },
  });
}

/** Save designer notes for an asset. */
export function setAssetNotes(assetId, notes) {
  const asset = assetById(assetId);
  return commitReview(assetId, {
    summary: `Notes on ${asset ? asset.name || asset.id : assetId}`,
    mutate: (e) => { e.notes = String(notes || '').replace(/\r\n/g, '\n'); },
  });
}

/**
 * Attach a replacement: an image file (bytes + ext) or replacement text. Writes the file to
 * design/assets/replacements/<safeId>/<UTC stamp>.<ext> and sets status replaced, in one commit.
 */
export function attachReplacement(assetId, { bytes, ext, text, note = '' }) {
  const asset = assetById(assetId);
  const stamp = utcStamp();
  const isText = text != null && !bytes;
  const file = dpath(`assets/replacements/${safeId(assetId)}/${stamp}.${isText ? 'txt' : (ext || 'png').toLowerCase()}`);
  return commitReview(assetId, {
    summary: `Replacement for ${asset ? asset.name || asset.id : assetId}`,
    assetsLine: { group: asset.group, id: assetId, from: reviewOf(asset).status, to: 'replaced' },
    note,
    mutate: (e) => {
      const fromStatus = e.status;
      e.replacement = { path: file, text: isText ? String(text) : null, by: me(), at: new Date().toISOString() };
      e.history = e.history || [];
      e.history.push({ at: e.replacement.at, by: me(), status: 'replaced', contentHash: e.contentHash || asset.contentHash || '', note: note || `Replacement attached (was ${fromStatus.replace(/_/g, ' ')})` });
      e.status = 'replaced';
      return [isText ? { path: file, text: normText(text) } : { path: file, bytes }];
    },
  });
}

/** Remove the replacement (keeps the file in git history; status back to needs_replacement). */
export function clearReplacement(assetId) {
  const asset = assetById(assetId);
  return commitReview(assetId, {
    summary: `Remove replacement for ${asset ? asset.name || asset.id : assetId}`,
    assetsLine: { group: asset.group, id: assetId, from: reviewOf(asset).status, to: 'needs_replacement' },
    mutate: (e) => {
      e.replacement = null;
      e.history = e.history || [];
      e.history.push({ at: new Date().toISOString(), by: me(), status: 'needs_replacement', contentHash: e.contentHash || '', note: 'Replacement removed' });
      e.status = 'needs_replacement';
    },
  });
}

export { displayText, cellCanon, utf8 };
