// History (contract §8): the activity feed of every change under design/, from the branch's commits.
// Query filters: table + key + column (one value's history), table alone, page (id or file path).
import { html } from '../lib.js';
import { useEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { Icon } from '../icons.js';
import { useStore } from '../store.js';
import * as G from '../github.js';
import { repoStore, schemaTable, rowName, pageById, pagePath, dpath } from '../repo.js';
import { parseCommitMessage } from '../commitmsg.js';
import { setQuery } from '../router.js';
import { CommitItem } from '../components/feed.js';
import { EmptyState, ErrorPanel, SkeletonLines, Btn, IconBtn } from '../components/ui.js';
import { groupByDay, commitTime } from '../pages/util.js';

function filterOf(query, designRoot) {
  const { table, key, column, page } = query;
  if (table) {
    const path = dpath(`tuning/tables/${table}.json`);
    const match = (c) => c.table === table && (!key || c.key === key) && (!column || c.column === column);
    return { kind: 'cell', path, match };
  }
  if (page) {
    const pg = pageById(page);
    const path = pg ? pagePath(pg) : String(page);
    return { kind: 'page', path, page: pg };
  }
  return { kind: 'all', path: designRoot || 'design' };
}

function Chip({ label, onClear }) {
  return html`<span class="pg-fchip">${label}<button type="button" class="icon-btn icon-btn-sm" aria-label=${`Clear filter: ${label}`} title="Clear" onClick=${onClear}><${Icon} name="x" size=${12} /></button></span>`;
}

export function HistoryView({ query = {} }) {
  const head = useStore(repoStore, (s) => s.head);
  const designRoot = useStore(repoStore, (s) => s.designRoot);
  const [items, setItems] = useState(null);
  const [more, setMore] = useState(false);
  const [pageN, setPageN] = useState(1);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);
  const flt = filterOf(query, designRoot);
  const fkey = [flt.path, query.table, query.key, query.column, query.page].join('|');

  const fetchPage = async (n) => {
    const s = repoStore.get();
    const r = await G.listCommits(s.owner, s.repo, { sha: s.branch, path: flt.path, perPage: 30, page: n });
    const list = flt.match ? r.commits.filter((c) => parseCommitMessage(c.commit.message).cells.some(flt.match)) : r.commits;
    return { list, hasMore: r.hasMore };
  };
  const load = () => {
    const my = ++seq.current;
    setError(null);
    fetchPage(1).then((r) => { if (my !== seq.current) return; setItems(r.list); setMore(r.hasMore); setPageN(1); }).catch((e) => { if (my === seq.current) setError(e); });
  };
  useEffect(() => { setItems(null); load(); }, [fkey]);
  useEffect(() => { if (items) load(); }, [head]);
  const loadMore = async () => {
    if (busy || !more) return;
    setBusy(true);
    const my = seq.current;
    try {
      // keep going until something matches (per-value history can skip whole pages)
      let n = pageN, got = [], hasMore = more;
      do { n++; const r = await fetchPage(n); got = got.concat(r.list); hasMore = r.hasMore; } while (!got.length && hasMore && n - pageN < 5);
      if (my === seq.current) { setItems((x) => [...(x || []), ...got]); setMore(hasMore); setPageN(n); }
    } catch (e) { if (my === seq.current) setError(e); }
    setBusy(false);
  };

  const chips = [];
  if (query.table) {
    const st = schemaTable(query.table);
    chips.push(html`<${Chip} key="t" label=${html`<${Icon} name="sliders" size=${12} /> ${st ? st.label || st.id : query.table}`} onClear=${() => setQuery({ table: null, key: null, column: null })} />`);
    if (query.key) chips.push(html`<${Chip} key="k" label=${rowName(query.table, query.key)} onClear=${() => setQuery({ key: null, column: null })} />`);
    if (query.column) {
      const col = st && st.columns.find((c) => c.id === query.column);
      chips.push(html`<${Chip} key="c" label=${col ? col.label || col.id : query.column} onClear=${() => setQuery({ column: null })} />`);
    }
  }
  if (query.page) chips.push(html`<${Chip} key="p" label=${html`<${Icon} name="file-text" size=${12} /> ${flt.page ? flt.page.title : query.page}`} onClear=${() => setQuery({ page: null })} />`);
  const filtered = chips.length > 0;
  const days = groupByDay(items || [], commitTime);
  const sub = query.table && query.key && query.column ? 'Every saved change to this value.'
    : filtered ? 'Changes matching the filters below.'
    : 'Every change to the design docs, tuning values and asset reviews — from the app, from Claude and from the engine sync.';

  return html`<div class="container container-narrow pg-history">
    <header class="page-head">
      <div class="page-head-main">
        <h1 class="page-title">History</h1>
        <div class="page-sub">${sub}</div>
      </div>
      <div class="page-head-actions"><${IconBtn} icon="refresh" label="Refresh" onClick=${load} /></div>
    </header>
    ${filtered && html`<div class="filter-row pg-hist-filters"><span class="muted pg-small">Showing</span>${chips}
      <button type="button" class="link-btn pg-small" onClick=${() => setQuery({ table: null, key: null, column: null, page: null })}>Show everything</button></div>`}
    ${error && !items ? html`<${ErrorPanel} error=${error} title="Couldn't load the history" onRetry=${load} />`
      : !items ? html`<${SkeletonLines} lines=${10} />`
      : !items.length && !more ? html`<${EmptyState} icon="history" title=${filtered ? 'No changes match these filters' : 'No changes yet'}>
          ${filtered ? html`<button type="button" class="link-btn" onClick=${() => setQuery({ table: null, key: null, column: null, page: null })}>Show all changes</button>` : 'Changes appear here as soon as someone saves.'}<//>`
      : html`<div class="feed-days">
          ${days.map((d) => html`<section class="feed-day" key=${d.label}>
            <h2 class="feed-day-title">${d.label}</h2>
            <ul class="pg-commits">${d.items.map((c) => html`<${CommitItem} key=${c.sha} commit=${c} cellFilter=${flt.match && (query.key || query.column) ? flt.match : null} />`)}</ul>
          </section>`)}
          ${!items.length && html`<p class="muted pg-small">Nothing in the most recent changes.</p>`}
          ${more ? html`<div class="feed-more"><${Btn} onClick=${loadMore} loading=${busy}>Load more<//></div>` : html`<p class="muted feed-end">That's everything.</p>`}
          ${error && html`<${ErrorPanel} error=${error} compact />`}
        </div>`}
  </div>`;
}
