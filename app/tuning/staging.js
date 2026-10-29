// Staging store (Tuning Desk App.html §4): unsaved cell changes {table,key,column,from,to} keyed by cell,
// shared by the Tuning view and every embed. Persisted per repo in localStorage (hub.staged.<owner>/<repo>).
// `from` = cellValue() at the moment of the first edit. After the repo reloads (repoStore.version changes)
// entries are re-checked: current == to → dropped; current != from → conflict {current}.
import { useEffect } from '../../vendor/hooks.module.js';
import { createStore, useStore } from '../store.js';
import { storage, plural } from '../lib.js';
import { repoStore, cellValue, schemaTable, tableRows } from '../repo.js';
import { colEditable } from '../canon.js';
import { toast } from '../components/toast.js';
import { cellId } from './model.js';

export const stageStore = createStore({
  key: null,          // "owner/repo" the entries belong to
  entries: {},        // cellId → {table,key,column,from,to, conflict?: {current}}
  undo: [], redo: [],
  saving: false,
  note: '',
  ui: null,           // global overlay on top: {kind:'review'|'conflict'|'propose'|'comment'|'list'|'enum'|…, …}
  drawer: null,       // row drawer: {tid, key, focus}
  flash: {},          // cellId → until (ms) – cells to flash after undo/paste
});
const SS = () => stageStore.get();
const storeKey = (k) => 'hub.staged.' + k;

function persist() {
  const s = SS(); if (!s.key) return;
  const list = Object.values(s.entries);
  if (list.length) storage.set(storeKey(s.key), { entries: list, note: s.note || '' });
  else { try { localStorage.removeItem(storeKey(s.key)); } catch (e) { /* ignore */ } }
}
function setEntries(entries, extra) { stageStore.set({ entries, ...(extra || {}) }); persist(); }

// Read-only users never see unsaved changes (they may share a browser profile with an editor).
const EMPTY = Object.freeze({});
export function currentValue(tid, key, cid) {
  const e = repoStore.get().canPush ? SS().entries[cellId(tid, key, cid)] : null;
  return e ? e.to : cellValue(tid, key, cid);
}
export function entryOf(tid, key, cid) { return SS().entries[cellId(tid, key, cid)] || null; }
export const stagedList = () => Object.values(SS().entries);
export const conflictList = () => stagedList().filter((e) => e.conflict);

/** Re-validate staged entries against what the repo has now. */
function recheck({ quiet } = {}) {
  const s = SS(); let dropped = 0, conflicts = 0;
  const next = {};
  for (const [id, e] of Object.entries(s.entries)) {
    const st = schemaTable(e.table), col = st && st.columns.find((c) => c.id === e.column);
    const row = st && tableRows(e.table).find((r) => r.key === e.key);
    if (!col || !row || !colEditable(col)) { dropped++; continue; }
    const cur = cellValue(e.table, e.key, e.column);
    if (cur === e.to) { dropped++; continue; }
    if (cur !== e.from) { next[id] = { ...e, conflict: { current: cur } }; if (!e.conflict || e.conflict.current !== cur) conflicts++; }
    else { const { conflict, ...rest } = e; next[id] = rest; }
  }
  setEntries(next);
  if (quiet) return;
  if (dropped) toast(`${plural(dropped, 'unsaved change')} no longer ${dropped === 1 ? 'applies' : 'apply'}`, { detail: 'The row or column was removed, or someone already made the same change.' });
  if (conflicts) toast(`${plural(conflicts, 'unsaved change')} now ${conflicts === 1 ? 'conflicts' : 'conflict'} with a newer version`, { kind: 'error', detail: 'Someone changed these values after you edited them.', action: { label: 'Review', run: () => openReview() } });
}

// Follow the repo: load this repo's staged entries, re-check after every reload.
let lastVersion = -1, lastKey = null;
function onRepo(rs) {
  if (rs.key !== lastKey) {
    lastKey = rs.key; lastVersion = -1;
    const saved = rs.key ? storage.get(storeKey(rs.key), null) : null;
    const entries = {};
    if (saved && Array.isArray(saved.entries)) for (const e of saved.entries) if (e && e.table && e.key && e.column) entries[cellId(e.table, e.key, e.column)] = e;
    stageStore.set({ key: rs.key, entries, undo: [], redo: [], note: (saved && saved.note) || '', ui: null, drawer: null });
  }
  if (rs.status === 'ready' && rs.version !== lastVersion) {
    lastVersion = rs.version;
    if (rs.canPush && Object.keys(SS().entries).length) recheck({ quiet: SS().saving });
  }
}
repoStore.subscribe(onRepo);
onRepo(repoStore.get());

/**
 * Stage values. changes: [{table, key, column, to}] (`to` canonical).
 * opts: {label, coalesce} – coalesce merges into the previous undo step with the same tag (nudging, sliders).
 * Returns the number of cells that changed.
 */
export function stage(changes, opts = {}) {
  if (!repoStore.get().canPush) return 0;
  const s = SS(), entries = { ...s.entries }, ops = [];
  for (const c of changes) {
    const st = schemaTable(c.table), col = st && st.columns.find((x) => x.id === c.column);
    if (!col || !colEditable(col)) continue;
    const server = cellValue(c.table, c.key, c.column); if (server === null) continue;
    const id = cellId(c.table, c.key, c.column), before = entries[id] || null;
    const from = before ? before.from : server;
    let after;
    if (before && before.conflict) after = c.to === before.conflict.current ? null : { table: c.table, key: c.key, column: c.column, from, to: c.to, conflict: before.conflict };
    else after = c.to === from ? null : { table: c.table, key: c.key, column: c.column, from, to: c.to };
    if (JSON.stringify(before) === JSON.stringify(after)) continue;
    ops.push({ id, before, after });
    if (after) entries[id] = after; else delete entries[id];
  }
  if (!ops.length) return 0;
  let undo = s.undo.slice();
  const last = undo[undo.length - 1];
  if (opts.coalesce && last && last.coalesce === opts.coalesce && Date.now() - last.t < 1500) {
    const merged = { ...last, ops: last.ops.slice(), t: Date.now() };
    for (const op of ops) { const i = merged.ops.findIndex((o) => o.id === op.id); if (i >= 0) merged.ops[i] = { ...merged.ops[i], after: op.after }; else merged.ops.push(op); }
    undo[undo.length - 1] = merged;
  } else {
    undo.push({ label: opts.label || (ops.length === 1 ? 'change' : plural(ops.length, 'change')), ops, coalesce: opts.coalesce, t: Date.now() });
    if (undo.length > 200) undo = undo.slice(-200);
  }
  setEntries(entries, { undo, redo: [] });
  return ops.length;
}

function applyOps(ops, which) {
  const entries = { ...SS().entries };
  for (const op of ops) { const v = which === 'after' ? op.after : op.before; if (v) entries[op.id] = v; else delete entries[op.id]; }
  return entries;
}
function flash(ids) {
  const until = Date.now() + 1400, f = { ...SS().flash };
  for (const id of ids) f[id] = until;
  stageStore.set({ flash: f });
  setTimeout(() => { const g = { ...SS().flash }; let ch = false; for (const id of ids) if (g[id] <= Date.now()) { delete g[id]; ch = true; } if (ch) stageStore.set({ flash: g }); }, 1500);
}
export function undo() {
  const s = SS(); const u = s.undo[s.undo.length - 1];
  if (!u) { toast('Nothing to undo'); return; }
  setEntries(applyOps(u.ops.slice().reverse(), 'before'), { undo: s.undo.slice(0, -1), redo: [...s.redo, u] });
  flash(u.ops.map((o) => o.id));
  toast('Undid: ' + u.label, { duration: 1600 });
}
export function redo() {
  const s = SS(); const u = s.redo[s.redo.length - 1];
  if (!u) { toast('Nothing to redo'); return; }
  setEntries(applyOps(u.ops, 'after'), { redo: s.redo.slice(0, -1), undo: [...s.undo, u] });
  flash(u.ops.map((o) => o.id));
  toast('Redid: ' + u.label, { duration: 1600 });
}
export function discard(ids, label) {
  const s = SS();
  const ops = ids.filter((id) => s.entries[id]).map((id) => ({ id, before: s.entries[id], after: null }));
  if (!ops.length) return 0;
  setEntries(applyOps(ops, 'after'), { undo: [...s.undo, { label: label || ('Discard ' + plural(ops.length, 'change')), ops, t: Date.now() }], redo: [] });
  return ops.length;
}
export function discardAll() {
  const n = discard(Object.keys(SS().entries), 'Discard all');
  if (n) toast(`Discarded ${plural(n, 'unsaved change')}`, { action: { label: 'Undo', icon: 'undo', run: undo } });
}
/** Resolve a conflict: keep mine → from = their current value; keep theirs → drop the change. */
export function resolveConflict(id, keepMine) {
  const s = SS(), e = s.entries[id]; if (!e || !e.conflict) return;
  let after = keepMine ? { table: e.table, key: e.key, column: e.column, from: e.conflict.current, to: e.to } : null;
  if (after && after.from === after.to) after = null;
  const op = { id, before: e, after };
  setEntries(applyOps([op], 'after'), { undo: [...s.undo, { label: keepMine ? 'Use mine' : 'Keep theirs', ops: [op], t: Date.now() }], redo: [] });
}
/** Mark entries as conflicting (from a commitTuning conflict result). */
export function markConflicts(conflicts) {
  const entries = { ...SS().entries };
  for (const c of conflicts) {
    const id = cellId(c.table, c.key, c.column), e = entries[id];
    if (e) entries[id] = { ...e, conflict: { current: c.current, missing: c.current === null } };
  }
  setEntries(entries);
}
/** Remove entries after a save (only those still holding the saved value). */
export function clearSaved(changes) {
  const entries = { ...SS().entries };
  for (const c of changes) { const id = cellId(c.table, c.key, c.column); if (entries[id] && entries[id].to === c.to) delete entries[id]; }
  setEntries(entries, { undo: [], redo: [] });
}
export function setNote(note) { stageStore.set({ note }); persist(); }

// ------------------------------------------------------------- global overlay requests
export function openUi(ui) { stageStore.set({ ui }); }
export function closeUi() { stageStore.set({ ui: null }); }
export function openDrawer(tid, key, focus) { stageStore.set({ drawer: { tid, key, focus: focus || null } }); }
export function closeDrawer() { stageStore.set({ drawer: null }); }
export const openReview = () => { if (stagedList().length) openUi({ kind: 'review' }); else toast('Nothing to save yet', { detail: 'Edit a value and it will appear here for review.' }); };

// ------------------------------------------------------------- hooks
export function useEntries() { const e = useStore(stageStore, (s) => s.entries); const can = useStore(repoStore, (s) => s.canPush); return can ? e : EMPTY; }
export function useFlash() { return useStore(stageStore, (s) => s.flash); }
/** Entries of one table, as a Map cid-key → entry (re-renders on any staging change). */
export function countIn(entries, tid, key) {
  let n = 0;
  for (const e of Object.values(entries)) if (e.table === tid && (key == null || e.key === key)) n++;
  return n;
}

// ------------------------------------------------------------- undo/redo + save keys (Tuning view and embeds)
let keyUsers = 0;
function onKey(e) {
  const mod = e.ctrlKey || e.metaKey; if (!mod) return;
  const t = e.target, k = e.key.toLowerCase();
  const typing = t && (t.tagName === 'TEXTAREA' || t.isContentEditable || (t.tagName === 'INPUT' && !/^(checkbox|radio|range|color|button)$/i.test(t.type)) || t.tagName === 'SELECT');
  if (k === 's' && stagedList().length && repoStore.get().canPush) { e.preventDefault(); openReview(); return; }
  if (typing || SS().ui) return;
  if (k === 'z' || k === 'y') {
    if (!repoStore.get().canPush) return;
    if (!SS().undo.length && !SS().redo.length) return;
    e.preventDefault();
    if (k === 'y' || e.shiftKey) redo(); else undo();
  }
}
export function useUndoKeys() {
  useEffect(() => {
    if (keyUsers++ === 0) document.addEventListener('keydown', onKey);
    return () => { if (--keyUsers === 0) document.removeEventListener('keydown', onKey); };
  }, []);
}
