// Per-cell / per-row history (contract §8): commits that touched the table file whose message has a matching
// `table|key|col:` line, parsed with parseCommitMessage.
import { html, cx, plural } from '../lib.js';
import { useEffect, useState } from '../../vendor/hooks.module.js';
import { Icon } from '../icons.js';
import { Avatar, RelTime, Skeleton } from '../components/ui.js';
import * as G from '../github.js';
import { repoStore, dpath } from '../repo.js';
import { parseCommitMessage } from '../commitmsg.js';
import { colOf } from './model.js';
import { ChangeView } from './cells.js';

const cache = new Map(); // `${repo}@${head}:${path}` → Promise<entries>

/** All parsed hub cell changes for a table file: [{sha, url, at, who, login, source, note, summary, cells:[…]}], newest first. */
export function tableHistory(tid) {
  const s = repoStore.get();
  const t = s.tables[tid];
  const path = (t && t.path) || dpath(`tuning/tables/${tid}.json`);
  const k = `${s.key}@${s.head}:${path}`;
  if (!cache.has(k)) {
    const p = G.listCommits(s.owner, s.repo, { sha: s.branch, path, perPage: 50 }).then(({ commits }) => commits.map((c) => {
      const m = parseCommitMessage(c.commit && c.commit.message);
      const login = c.author && c.author.login;
      const who = m.source === 'claude' ? 'Claude' : login || (c.commit && c.commit.author && c.commit.author.name) || 'someone';
      return { sha: c.sha, url: c.html_url, at: Date.parse((c.commit && (c.commit.author || c.commit.committer) || {}).date) || 0, who, login, source: m.source, note: m.note, summary: m.summary, hub: m.hub, cells: m.cells };
    }));
    cache.set(k, p);
    p.catch(() => cache.delete(k));
  }
  return cache.get(k);
}

/** Flatten to cell-change entries for one row (and optionally one column). */
export function cellEntries(entries, tid, key, column) {
  const out = [];
  for (const e of entries) for (const c of e.cells) {
    if (c.table !== tid || c.key !== key || (column && c.column !== column)) continue;
    out.push({ ...e, cell: c });
  }
  return out;
}

export function useTableHistory(tid) {
  const head = repoStore.get().head;
  const [st, setSt] = useState({ loading: true, entries: null, error: null });
  useEffect(() => {
    let alive = true;
    setSt((x) => ({ ...x, loading: true }));
    tableHistory(tid).then((entries) => { if (alive) setSt({ loading: false, entries, error: null }); }, (e) => { if (alive) setSt({ loading: false, entries: null, error: e }); });
    return () => { alive = false; };
  }, [tid, head]);
  return st;
}

const ENGINE = { unity: 'Unity', godot: 'Godot' };
function HistItem({ e, tid, showCol }) {
  const col = colOf(tid, e.cell.column) || { id: e.cell.column, label: e.cell.column, type: 'string' };
  const bot = e.source === 'claude';
  return html`<li class="tn-hist-e">
    <${Avatar} actor=${bot ? 'Claude' : e.login || e.who} size=${24} />
    <div class="tn-hist-b">
      <div class="tn-hist-who"><b>${e.who}</b>${showCol && html` changed <b>${col.label || col.id}</b>`} · <${RelTime} at=${e.at} />
        ${ENGINE[e.source] && html` <span class="badge badge-accent tn-eng" title=${`Synced from the ${ENGINE[e.source]} project`}>${ENGINE[e.source]}</span>`}</div>
      <div class="tn-hist-what"><${ChangeView} col=${col} from=${e.cell.from == null ? '∅' : e.cell.from} to=${e.cell.to == null ? '∅' : e.cell.to} compact=${true} /></div>
      ${e.note && html`<div class="tn-hist-note">“${e.note}”</div>`}
      ${e.url && html`<a class="tn-hist-gh" href=${e.url} target="_blank" rel="noopener noreferrer"><${Icon} name="github" size=${12} /> View on GitHub</a>`}
    </div>
  </li>`;
}

/** History list for a row (all columns) or one cell. */
export function HistoryList({ tid, rowKey, column, limit = 30 }) {
  const { loading, entries, error } = useTableHistory(tid);
  if (loading && !entries) return html`<div class="tn-hist-skel"><${Skeleton} w="100%" h=${36} /><${Skeleton} w="80%" h=${36} /></div>`;
  if (error) return html`<div class="muted tn-hist-none">Couldn't load the history: ${error.message || String(error)}</div>`;
  const list = cellEntries(entries || [], tid, rowKey, column);
  if (!list.length) return html`<div class="muted tn-hist-none">${column ? 'No saved changes to this value yet' : 'No saved changes to this row yet'} (last 50 versions of the table).</div>`;
  return html`<ul class="tn-hist">${list.slice(0, limit).map((e) => html`<${HistItem} key=${e.sha + e.cell.column} e=${e} tid=${tid} showCol=${!column} />`)}</ul>
    ${list.length > limit && html`<div class="muted tn-hist-none">${plural(list.length - limit, 'older change')} not shown.</div>`}`;
}
