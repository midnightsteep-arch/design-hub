// Tuning section: landing (groups → table cards) and table page (family tabs, section tabs, toolbar, grid/cards).
// Route: #/<o>/<r>/tuning[/<tableId>]?s=<section|(none)>&row=<key>&view=grid|cards
import { html, cx, plural, storage } from '../lib.js';
import { useState, useEffect, useRef } from '../../vendor/hooks.module.js';
import { Icon } from '../icons.js';
import { useStore } from '../store.js';
import { repoStore, schemaTable, tableRows } from '../repo.js';
import { discussStore, threadsFor } from '../discuss.js';
import { href, setQuery } from '../router.js';
import { tuningGroups } from '../components/nav.js';
import { EmptyState, Segmented } from '../components/ui.js';
import { useEntries, currentValue, openReview, useUndoKeys } from './staging.js';
import { rootOf, familyOf, childTablesOf, sectionTable, sectionList, sectionFromQuery, sectionToQuery, sortedRows, groupRows, UNASSIGNED } from './model.js';
import { countOf, nounPlural } from './model.js';
import { Grid } from './grid.js';
import { Cards } from './cards.js';

const DENSITY_KEY = 'hub.tuning.density';
const VIEW_KEY = 'hub.tuning.view';

/** Rows after the toolbar filters (search text over name + every value; changed only). */
export function filterRows(tid, rows, { text, changedOnly, entries }) {
  const t = schemaTable(tid), q = (text || '').trim().toLowerCase();
  let out = rows;
  if (changedOnly) out = out.filter((r) => Object.values(entries).some((e) => e.table === tid && e.key === r.key));
  if (q) out = out.filter((r) => String(r.name).toLowerCase().includes(q) || t.columns.some((c) => { const v = currentValue(tid, r.key, c.id); return v != null && String(v).toLowerCase().includes(q); }));
  return out;
}

function TableCard({ t, entries, threads }) {
  const kids = childTablesOf(t.id);
  const fam = familyOf(t.id);
  const staged = Object.values(entries).filter((e) => fam.includes(e.table)).length;
  const open = fam.reduce((n, id) => n + threadsFor(threads, { type: 'table', table: id }, { openOnly: true }).length, 0);
  const rows = tableRows(t.id).length;
  return html`<a class="card tn-tcard" href=${href.tuning(t.id)}>
    <div class="tn-tcard-head">
      <span class="tn-tcard-ic"><${Icon} name=${t.defaultView === 'cards' ? 'layout' : 'table'} size=${17} /></span>
      <span class="tn-tcard-name">${t.label || t.id}</span>
      ${staged > 0 && html`<span class="badge badge-accent" title="Unsaved changes in this table">${plural(staged, 'unsaved change')}</span>`}
    </div>
    ${t.description && html`<p class="tn-tcard-desc">${t.description}</p>`}
    <div class="tn-tcard-meta muted">
      <span>${countOf(rows, t.rowLabel)}</span><span>·</span><span>${plural(t.columns.length, 'column')}</span>
      ${t.sectionBy && html`<span>·</span><span>${plural((sectionList(t.id) || []).length, 'section')}</span>`}
      ${open > 0 && html`<span class="tn-tcard-th" title="Open discussions"><${Icon} name="comment" size=${12} /> ${open}</span>`}
    </div>
    ${kids.length > 0 && html`<div class="tn-tcard-kids">${kids.map((k) => html`<span><${Icon} name="chevron-right" size=${12} />${k.label || k.id} <span class="muted">${tableRows(k.id).length}</span></span>`)}</div>`}
  </a>`;
}

function Landing() {
  const hub = useStore(repoStore, (s) => s.hub);
  const schema = useStore(repoStore, (s) => s.schema);
  useStore(repoStore, (s) => s.version);
  const entries = useEntries();
  const threads = useStore(discussStore, (s) => s.threads);
  const canPush = useStore(repoStore, (s) => s.canPush);
  if (!schema) {
    return html`<div class="container container-narrow"><${EmptyState} icon="sliders" title="No tuning tables yet">
      The game project hasn't published its tunable data. Ask a developer to run the engine sync (Design Hub → Sync) — the tables appear here as soon as it's pushed.<//></div>`;
  }
  const groups = tuningGroups(hub, schema);
  const n = Object.keys(entries).length;
  return html`<div class="container tn-page">
    <header class="page-head tn-head">
      <div class="page-head-main">
        <h1 class="page-title"><${Icon} name="sliders" size=${20} class="page-title-icon" />Tuning</h1>
        <div class="page-sub">The game's numbers and text. ${canPush ? 'Edit any value, review your changes, then save — the game picks them up at the next engine sync.' : 'You have read-only access: open a table and propose changes for the team to discuss.'}</div>
      </div>
      ${n > 0 && canPush && html`<div class="page-head-actions"><button type="button" class="btn btn-primary" onClick=${openReview}>Review ${plural(n, 'change')}</button></div>`}
    </header>
    ${groups.map((g) => html`<section class="tn-lgroup" key=${g.name}>
      <h2 class="tn-lgroup-h">${g.name}</h2>
      <div class="tn-lgrid">${g.tables.map((t) => html`<${TableCard} key=${t.id} t=${t} entries=${entries} threads=${threads} />`)}</div>
    </section>`)}
  </div>`;
}

/** Toolbar + body shared by the table page and the embed. */
export function TableBody({ tid, section, view, density, highlight, compact, text, changedOnly }) {
  const entries = useEntries();
  useStore(repoStore, (s) => s.version);
  const t = schemaTable(tid);
  let rows = sortedRows(tid);
  if (section != null && sectionTable(tid)) {
    const st = sectionTable(tid);
    rows = rows.filter((r) => { const v = currentValue(st.id, r.key.split('/')[0], st.sectionBy); return (v == null ? '' : String(v)) === section; });
  }
  const filtered = filterRows(tid, rows, { text, changedOnly, entries });
  const groups = groupRows(tid, filtered, section, currentValue);
  const empty = (text || changedOnly) ? 'No rows match the current filter.' : section != null ? 'Nothing in this section.' : `This table has no ${t.rowLabel ? nounPlural(t.rowLabel) : 'rows'} yet. Rows come from the game project.`;
  return view === 'cards'
    ? html`<${Cards} tid=${tid} rows=${filtered} groups=${groups} highlight=${highlight} emptyText=${empty} />`
    : html`<${Grid} tid=${tid} rows=${filtered} groups=${groups} density=${density} highlight=${highlight} compact=${compact} emptyText=${empty} />`;
}

export function SearchBox({ value, onInput, placeholder = 'Filter rows…', small }) {
  const ref = useRef(null);
  useEffect(() => {
    if (small) return undefined;
    const onKey = (e) => { if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test((e.target && e.target.tagName) || '') && !(e.target && e.target.isContentEditable) && ref.current) { e.preventDefault(); ref.current.focus(); ref.current.select(); } };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
  return html`<label class=${cx('tn-search', small && 'is-small')}><${Icon} name="search" size=${14} /><span class="sr-only">${placeholder}</span>
    <input ref=${ref} class="input input-sm" type="search" placeholder=${placeholder} value=${value} autocomplete="off" spellcheck=${false}
      onInput=${(e) => onInput(e.currentTarget.value)} onKeyDown=${(e) => { if (e.key === 'Escape' && value) { e.preventDefault(); e.stopPropagation(); onInput(''); } }} /></label>`;
}

function TablePage({ tid, query }) {
  const t = schemaTable(tid);
  useStore(repoStore, (s) => s.version);
  const canPush = useStore(repoStore, (s) => s.canPush);
  const hub = useStore(repoStore, (s) => s.hub);
  const schema = useStore(repoStore, (s) => s.schema);
  const entries = useEntries();
  const threads = useStore(discussStore, (s) => s.threads);
  const [text, setText] = useState('');
  const [changedOnly, setChangedOnly] = useState(false);
  const [density, setDensity] = useState(() => storage.get(DENSITY_KEY, 'compact'));
  const [viewPref, setViewPref] = useState(() => storage.get(VIEW_KEY, {}));
  useEffect(() => { setText(''); setChangedOnly(false); }, [tid]);
  if (!t) {
    return html`<div class="container container-narrow"><${EmptyState} icon="table" title="This table doesn't exist"
      action=${html`<a class="btn btn-secondary" href=${href.tuning()}>All tuning tables</a>`}>There is no tuning table called “${tid}”. It may have been renamed in the game project.<//></div>`;
  }
  const root = schemaTable(rootOf(tid)), fam = familyOf(root.id);
  const group = (tuningGroups(hub, schema).find((g) => g.tables.some((x) => x.id === root.id)) || {}).name || root.group || 'Other';
  const secs = sectionTable(tid) ? sectionList(tid, currentValue) : null;
  let section = sectionFromQuery(query.s);
  if (secs && section != null && !secs.some((s) => s.value === section)) section = null;
  if (!secs) section = null;
  const view = query.view === 'grid' || query.view === 'cards' ? query.view : viewPref[tid] || (t.defaultView === 'cards' ? 'cards' : 'grid');
  const setView = (v) => { const p = { ...viewPref, [tid]: v }; setViewPref(p); storage.set(VIEW_KEY, p); setQuery({ view: null }); };
  const setDens = (d) => { setDensity(d); storage.set(DENSITY_KEY, d); };
  const total = tableRows(tid).length;
  const secCount = section == null ? total : (secs.find((s) => s.value === section) || {}).count || 0;
  const famDirty = (id) => Object.values(entries).some((e) => e.table === id);
  const secDirty = (v) => Object.values(entries).some((e) => fam.includes(e.table) && (v == null || (() => { const st = sectionTable(e.table); const x = st && currentValue(st.id, e.key.split('/')[0], st.sectionBy); return (x == null ? '' : String(x)) === v; })()));
  const nStagedHere = Object.values(entries).filter((e) => fam.includes(e.table)).length;
  const openN = threadsFor(threads, { type: 'table', table: tid }, { openOnly: true }).length;
  return html`<div class="container container-wide tn-page tn-table-page">
    <nav class="tn-crumbs muted" aria-label="Breadcrumb"><a href=${href.tuning()}>Tuning</a><${Icon} name="chevron-right" size=${12} /><span>${group}</span>
      ${root !== t && html`<${Icon} name="chevron-right" size=${12} /><a href=${href.tuning(root.id)}>${root.label || root.id}</a>`}</nav>
    <header class="tn-thead">
      <div class="tn-thead-main">
        <h1 class="page-title">${t.label || t.id}${section != null && html`<span class="tn-secname">· ${section || UNASSIGNED}</span>`}<span class="tn-count">${countOf(secCount, t.rowLabel)}</span></h1>
        ${(t.description || (root !== t && root.description)) && html`<p class="page-sub">${t.description || root.description}</p>`}
      </div>
      <div class="tn-thead-acts">
        ${openN > 0 && html`<a class="btn btn-sm btn-ghost" href=${href.discussions(null, { table: tid })} title="Open discussions about this table"><${Icon} name="comment" size=${14} /> ${openN}</a>`}
        <a class="btn btn-sm btn-secondary" href=${href.history({ table: tid })}><${Icon} name="history" size=${14} /> History</a>
      </div>
    </header>
    ${fam.length > 1 && html`<nav class="seg-tabs tn-famtabs" aria-label="Tables">${fam.map((id) => {
      const ft = schemaTable(id);
      return html`<a key=${id} class=${cx('seg-tab', id === tid && 'is-active')} href=${href.tuning(id)} aria-current=${id === tid ? 'page' : undefined}>
        ${ft.parent && html`<${Icon} name="layers" size=${13} />`}<span>${ft.label || ft.id}</span><span class="seg-count">${tableRows(id).length}</span>${famDirty(id) && html`<span class="tn-dot" title="Unsaved changes"></span>`}</a>`;
    })}</nav>`}
    ${secs && html`<div class="tn-sectabs" role="tablist" aria-label="Sections">
      <button type="button" role="tab" aria-selected=${String(section == null)} class=${cx('tn-sectab', section == null && 'is-on')} onClick=${() => setQuery({ s: null })}>All<span class="tn-cnt">${total}</span>${secDirty(null) && html`<span class="tn-dot"></span>`}</button>
      ${secs.map((s) => html`<button type="button" role="tab" key=${s.value} aria-selected=${String(section === s.value)} class=${cx('tn-sectab', section === s.value && 'is-on', s.value === '' && 'is-un')}
        onClick=${() => setQuery({ s: sectionToQuery(s.value) })}>${s.name}<span class="tn-cnt">${s.count}</span>${secDirty(s.value) && html`<span class="tn-dot"></span>`}</button>`)}
    </div>`}
    ${!canPush && html`<div class="tn-ro-note"><${Icon} name="eye" size=${14} /><span>You have read-only access. Select a value and press Enter — or right-click it — to <b>propose a change</b> for the team.</span></div>`}
    <div class="tn-toolbar">
      <${SearchBox} value=${text} onInput=${setText} />
      ${canPush && html`<label class="toggle tn-changed"><input type="checkbox" checked=${changedOnly} onChange=${(e) => setChangedOnly(e.currentTarget.checked)} />Changed only${nStagedHere ? html` <span class="muted">(${nStagedHere})</span>` : ''}</label>`}
      <span class="grow"></span>
      ${view === 'grid' && html`<${Segmented} label="Row density" size="sm" value=${density} onChange=${setDens} options=${[{ value: 'compact', icon: 'list', title: 'Compact rows' }, { value: 'comfy', icon: 'menu', title: 'Comfortable rows' }]} />`}
      <${Segmented} label="View" size="sm" value=${view} onChange=${setView} options=${[{ value: 'grid', label: 'Grid', icon: 'table' }, { value: 'cards', label: 'Cards', icon: 'layout' }]} />
    </div>
    <${TableBody} tid=${tid} section=${section} view=${view} density=${density} highlight=${query.row} text=${text} changedOnly=${changedOnly} />
  </div>`;
}

export function TuningView({ tableId, query = {} }) {
  const status = useStore(repoStore, (s) => s.status);
  useUndoKeys();
  if (status !== 'ready') return null;
  return tableId ? html`<${TablePage} key=${tableId} tid=${tableId} query=${query} />` : html`<${Landing} />`;
}
