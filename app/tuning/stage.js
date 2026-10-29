// StagingBar (mounted once by the repo shell) + the global tuning overlays it hosts: review & save, conflict
// resolution, cell editor popovers, list editor, propose/comment dialogs and the row drawer (App.html §12).
import { html, cx, plural, isMac } from '../lib.js';
import { useEffect, useState, useRef } from '../../vendor/hooks.module.js';
import { Icon } from '../icons.js';
import { Modal } from '../components/overlay.js';
import { toast } from '../components/toast.js';
import { AutoTextarea } from '../components/ui.js';
import { useStore, app } from '../store.js';
import { repoStore, commitTuning, schemaTable, rowName, reloadRepo } from '../repo.js';
import { displayText } from '../canon.js';
import { useRoute, href, navigate } from '../router.js';
import { stageStore, stagedList, conflictList, clearSaved, markConflicts, setNote, discard, discardAll, resolveConflict, closeUi,
  openUi, closeDrawer, openReview, useUndoKeys } from './staging.js';
import { cellId, colOf, tableLabel, allTables } from './model.js';
import { ChangeView } from './cells.js';
import { EditorFor } from './editors.js';
import { RowDrawer } from './drawer.js';

export { stageStore, openReview } from './staging.js';

const SS = () => stageStore.get();

/** Save every unsaved change in one commit (§8). Opens the conflict dialog when the values moved on. */
export async function saveAll() {
  if (SS().saving) return;
  if (conflictList().length) { openUi({ kind: 'conflict' }); return; }
  const list = stagedList(); if (!list.length) return;
  const note = SS().note || '';
  stageStore.set({ saving: true, saveError: null });
  const changes = list.map(({ table, key, column, from, to }) => ({ table, key, column, from, to }));
  try {
    const res = await commitTuning(changes, { note });
    if (res.status === 'conflict') {
      // Show the branch as it is now (their values), so "Use mine" re-applies on top of the latest version.
      // (commitTuning detects conflicts against the shown head when it hasn't moved on yet.)
      // reloadRepo bumps the repo version; the staging store then re-checks every entry against it (quietly, while saving).
      let reloaded = false;
      try { await reloadRepo(); reloaded = true; } catch (e) { /* offline: fall back to the conflicts we were given */ }
      if (!reloaded) markConflicts(res.conflicts);
      else markConflicts(res.conflicts.filter((c) => c.current === null));
      stageStore.set({ saving: false, ui: conflictList().length ? { kind: 'conflict' } : { kind: 'review' } });
      return;
    }
    clearSaved(changes); setNote('');
    stageStore.set({ saving: false, ui: null });
    if (res.status === 'nothing') toast('Nothing to save', { detail: 'These values already match the saved version.' });
    else toast(`Saved ${plural(changes.length, 'change')}`, { kind: 'success', detail: res.rebased ? "Merged with someone else's changes that were saved at the same time." : (note ? `“${note}”` : undefined) });
  } catch (e) {
    stageStore.set({ saving: false, saveError: (e && e.message) || String(e) });
  }
}

/** Entries grouped table → row, in schema order. */
function grouped(list) {
  const order = allTables().map((t) => t.id);
  const byT = new Map();
  for (const e of list) {
    if (!byT.has(e.table)) byT.set(e.table, new Map());
    const rows = byT.get(e.table);
    if (!rows.has(e.key)) rows.set(e.key, []);
    rows.get(e.key).push(e);
  }
  return [...byT.entries()].sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0])).map(([tid, rows]) => {
    const t = schemaTable(tid), cOrder = t ? t.columns.map((c) => c.id) : [];
    return { tid, rows: [...rows.entries()].map(([key, es]) => ({ key, entries: es.sort((a, b) => cOrder.indexOf(a.column) - cOrder.indexOf(b.column)) })) };
  });
}

function ReviewDialog({ onClose }) {
  const entries = useStore(stageStore, (s) => s.entries);
  const saving = useStore(stageStore, (s) => s.saving);
  const error = useStore(stageStore, (s) => s.saveError);
  const note = useStore(stageStore, (s) => s.note);
  const user = useStore(app, (s) => s.user);
  const list = Object.values(entries), cf = list.filter((e) => e.conflict).length;
  useEffect(() => { if (!list.length && !saving) onClose(); }, [list.length]);
  useEffect(() => { stageStore.set({ saveError: null }); }, []);
  const go = (tid, key) => { onClose(); navigate(href.tuning(tid, { row: key })); };
  return html`<${Modal} title=${`Review ${plural(list.length, 'change')}`} onClose=${onClose} size="lg" class="tn-review"
    footer=${html`<div class="tn-rv-foot">
      <label class="tn-rv-note"><span class="sr-only">Note</span>
        <${AutoTextarea} value=${note} minRows=${2} maxRows=${6} placeholder="What and why? (optional)" data-autofocus
          onInput=${(e) => setNote(e.currentTarget.value)} onKeyDown=${(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); saveAll(); } }} /></label>
      <div class="tn-rv-btns">
        <span class="muted tn-rv-who">${user ? `Saving as @${user.login}` : ''}</span><span class="grow"></span>
        <button type="button" class="btn btn-ghost" disabled=${saving} onClick=${() => { discardAll(); onClose(); }}>Discard all</button>
        <button type="button" class="btn btn-primary" disabled=${saving || !list.length} onClick=${saveAll}>
          ${saving ? html`<span class="spinner spinner-sm" aria-hidden="true"></span> Saving…` : cf ? 'Resolve conflicts…' : html`<${Icon} name="upload" size=${15} /> Save ${plural(list.length, 'change')}`}</button>
      </div></div>`}>
    <p class="muted tn-rv-sub">Nothing is saved until you press Save. Everyone sees the new values right away; the game picks them up at the next engine sync.</p>
    ${error && html`<div class="tn-err-box" role="alert"><${Icon} name="alert" size=${16} /><div><b>Couldn't save.</b> ${error} Your changes are still here — try again in a moment.</div></div>`}
    ${cf > 0 && html`<div class="tn-err-box" role="alert"><${Icon} name="alert" size=${16} /><div><b>${plural(cf, 'value')} changed since you edited ${cf === 1 ? 'it' : 'them'}.</b> Choose whose value to keep before saving.
      <button type="button" class="btn btn-sm btn-secondary tn-rv-resolve" onClick=${() => openUi({ kind: 'conflict' })}>Resolve…</button></div></div>`}
    ${grouped(list).map((g) => html`<section class="tn-rv-table" key=${g.tid}>
      <h3 class="tn-rv-th"><${Icon} name="table" size=${14} />${tableLabel(g.tid)}<span class="muted">${plural(g.rows.reduce((n, r) => n + r.entries.length, 0), 'change')}</span></h3>
      ${g.rows.map((r) => html`<div class="tn-rv-row" key=${r.key}>
        <button type="button" class="tn-rv-rh" title="Show in the table" onClick=${() => go(g.tid, r.key)}>${rowName(g.tid, r.key)}</button>
        ${r.entries.map((e) => {
          const col = colOf(g.tid, e.column) || { id: e.column, label: e.column, type: 'string' };
          return html`<div class=${cx('tn-rv-c', e.conflict && 'is-conflict')} key=${e.column}>
            <span class="tn-rv-cl" title=${col.label}>${col.label || col.id}</span>
            <div class="tn-rv-cv"><${ChangeView} col=${col} from=${e.from} to=${e.to} />
              ${e.conflict && html`<div class="tn-rv-cf">${e.conflict.missing ? 'This row no longer exists.' : html`Someone changed this to <b>${displayText(col, e.conflict.current, 60)}</b>.`}</div>`}</div>
            <button type="button" class="icon-btn icon-btn-sm" title="Remove this change" aria-label=${`Remove change to ${col.label}`} onClick=${() => discard([cellId(e.table, e.key, e.column)], 'Discard ' + (col.label || col.id))}><${Icon} name="x" size=${14} /></button>
          </div>`;
        })}
      </div>`)}
    </section>`)}
  <//>`;
}

function ConflictDialog({ onClose }) {
  const entries = useStore(stageStore, (s) => s.entries);
  const list = Object.values(entries).filter((e) => e.conflict);
  const [choice, setChoice] = useState({});
  useEffect(() => { if (!list.length) onClose(); }, [list.length]);
  const id = (e) => cellId(e.table, e.key, e.column);
  const all = (v) => { const c = {}; for (const e of list) c[id(e)] = e.conflict.missing ? 'theirs' : v; setChoice(c); };
  const pick = (e) => (e.conflict.missing ? 'theirs' : choice[id(e)]);
  const ready = list.every((e) => pick(e));
  const apply = () => {
    let mine = 0;
    for (const e of list) { const c = pick(e); if (c === 'mine') mine++; resolveConflict(id(e), c === 'mine'); }
    if (mine && stagedList().length && !conflictList().length) { stageStore.set({ ui: { kind: 'review' } }); setTimeout(saveAll, 0); return; }
    onClose();
    if (!mine) toast('Kept their values', { detail: 'Your edits to those values were dropped.' });
  };
  return html`<${Modal} title="Someone else changed these values" onClose=${onClose} size="lg" class="tn-conflict"
    footer=${html`<div class="tn-cf-foot"><span class="tn-cf-all"><button type="button" class="btn btn-sm btn-ghost" onClick=${() => all('theirs')}>Keep all theirs</button>
      <button type="button" class="btn btn-sm btn-ghost" onClick=${() => all('mine')}>Use all mine</button></span><span class="grow"></span>
      <button type="button" class="btn btn-secondary" onClick=${onClose}>Not now</button>
      <button type="button" class="btn btn-primary" disabled=${!ready} onClick=${apply}>Save with these choices</button></div>`}>
    <p class="muted tn-rv-sub">Nothing was saved yet. While you were editing, someone saved different values for ${list.length === 1 ? 'this cell' : 'these cells'}. Pick which value to keep for each.</p>
    <div class="tn-cf-list">${list.map((e) => {
      const col = colOf(e.table, e.column) || { id: e.column, label: e.column, type: 'string' };
      const c = pick(e), k = id(e);
      return html`<div class="tn-cf" key=${k}>
        <div class="tn-cf-h"><b>${rowName(e.table, e.key)}</b> · ${col.label || col.id} <span class="muted">${tableLabel(e.table)}</span></div>
        ${e.conflict.missing ? html`<p class="muted">This row was removed in the game project. Your change will be dropped.</p>` : html`
        <div class="tn-cf-vals">
          <div class="tn-cf-v"><span class="muted">You started from</span><b>${displayText(col, e.from, 60)}</b></div>
          <label class=${cx('tn-cf-v tn-cf-opt', c === 'theirs' && 'is-on')}><input type="radio" name=${k} checked=${c === 'theirs'} onChange=${() => setChoice({ ...choice, [k]: 'theirs' })} />
            <span class="muted">Theirs (saved now)</span><b>${displayText(col, e.conflict.current, 60)}</b><span class="tn-cf-act">Keep theirs</span></label>
          <label class=${cx('tn-cf-v tn-cf-opt', c === 'mine' && 'is-on')}><input type="radio" name=${k} checked=${c === 'mine'} onChange=${() => setChoice({ ...choice, [k]: 'mine' })} />
            <span class="muted">Yours</span><b>${displayText(col, e.to, 60)}</b><span class="tn-cf-act">Use mine</span></label>
        </div>`}
      </div>`;
    })}</div>
  <//>`;
}

/** Bottom bar ("N unsaved changes · Review & save") + host for every tuning overlay. */
export function StagingBar() {
  const entries = useStore(stageStore, (s) => s.entries);
  const ui = useStore(stageStore, (s) => s.ui);
  const drawer = useStore(stageStore, (s) => s.drawer);
  const saving = useStore(stageStore, (s) => s.saving);
  const canPush = useStore(repoStore, (s) => s.canPush);
  const ready = useStore(repoStore, (s) => s.status === 'ready');
  const route = useRoute();
  const path = route.hash.split('?')[0];
  const first = useRef(true);
  useUndoKeys();
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    closeDrawer();
    const u = SS().ui; if (u && u.kind !== 'review' && u.kind !== 'conflict') closeUi();
  }, [path]);
  const list = Object.values(entries), n = list.length, cf = list.filter((e) => e.conflict).length;
  const show = ready && canPush && n > 0;
  useEffect(() => { document.body.classList.toggle('tn-has-bar', show); return () => document.body.classList.remove('tn-has-bar'); }, [show]);
  const tables = [...new Set(list.map((e) => e.table))];
  return html`
    ${show && html`<div class=${cx('tn-stagebar', cf && 'has-conflict')} role="region" aria-label="Unsaved changes">
      <span class="tn-sb-msg"><span class="tn-sb-n">${n}</span><span><span class="tn-sb-long">unsaved </span>${n === 1 ? 'change' : 'changes'}${cf ? html` · <span class="tn-sb-cf">${plural(cf, 'conflict')}</span>` : ''}${tables.length === 1 && html`<span class="tn-sb-long muted"> in ${tableLabel(tables[0])}</span>`}</span></span>
      <button type="button" class="btn btn-sm btn-ghost tn-sb-discard" onClick=${discardAll} disabled=${saving} title="Discard all unsaved changes" aria-label="Discard all unsaved changes"><${Icon} name="trash" size=${14} /><span class="tn-sb-long">Discard</span></button>
      <button type="button" class="btn btn-sm btn-primary" onClick=${openReview} disabled=${saving}>${saving ? 'Saving…' : html`Review & save<kbd class="btn-kbd tn-sb-long">${isMac ? '⌘' : 'Ctrl'} S</kbd>`}</button>
    </div>`}
    ${drawer && ready && html`<${RowDrawer} tid=${drawer.tid} rowKey=${drawer.key} focus=${drawer.focus} onClose=${closeDrawer} />`}
    ${ui && ready && (ui.kind === 'review' ? html`<${ReviewDialog} onClose=${closeUi} />`
      : ui.kind === 'conflict' ? html`<${ConflictDialog} onClose=${() => stageStore.set({ ui: stagedList().length ? { kind: 'review' } : null })} />`
      : html`<${EditorFor} key=${ui.kind + ui.tid + ui.key + ui.cid} ui=${ui} onClose=${closeUi} />`)}`;
}
