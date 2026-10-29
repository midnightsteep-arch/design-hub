// Discussions = GitHub Issues (contract §9): hub-target parsing, thread store, create/reply/resolve/apply.
import { createStore } from './store.js';
import * as G from './github.js';
import { repoStore, commitTuning, rowName, schemaTable } from './repo.js';
import { displayText } from './canon.js';

const FENCE_RE = /^\s*```hub-target[ \t]*\r?\n([\s\S]*?)\r?\n```[ \t]*(?:\r?\n|$)/;

/** Parse an issue body → {target, text}. target null when the body has no hub-target block. */
export function parseBody(body) {
  const s = String(body || '');
  const m = FENCE_RE.exec(s);
  if (!m) return { target: null, text: s };
  let target = null;
  try { target = JSON.parse(m[1]); } catch (e) { target = null; }
  return { target, text: s.slice(m[0].length).replace(/^\s*\n/, '') };
}
/** Body with the target block on the first line (§9). */
export function buildBody(target, text) {
  return '```hub-target\n' + JSON.stringify(target) + '\n```\n' + (text ? '\n' + String(text).trim() + '\n' : '');
}
export const isHubIssue = (i) => (i.labels || []).some((l) => (l.name || l) === 'hub') || FENCE_RE.test(i.body || '');
const labelNames = (i) => (i.labels || []).map((l) => l.name || l);
/** open | applied | rejected | resolved */
export function threadState(i) {
  if (i.state === 'open') return 'open';
  const ls = labelNames(i);
  if (ls.includes('hub:applied')) return 'applied';
  if (ls.includes('hub:rejected')) return 'rejected';
  if (i.state_reason === 'not_planned') return 'rejected';
  return 'resolved';
}

export const discussStore = createStore({ key: null, threads: null, loading: false, error: null, at: 0 });

function toThread(i) {
  const { target, text } = parseBody(i.body);
  return { number: i.number, title: i.title, text, target: target || { type: 'general' }, state: threadState(i), open: i.state === 'open',
    labels: labelNames(i), user: i.user ? i.user.login : 'someone', created_at: i.created_at, updated_at: i.updated_at, comments: i.comments || 0, html_url: i.html_url, raw: i };
}

export async function loadThreads({ force } = {}) {
  const { owner, repo, key } = repoStore.get();
  if (!owner) return;
  const st = discussStore.get();
  if (!force && st.key === key && (st.threads || st.loading)) return;
  discussStore.set({ key, loading: true, error: null, ...(st.key !== key ? { threads: null } : {}) });
  try {
    const issues = await G.listIssues(owner, repo, { state: 'all' });
    if (repoStore.get().key !== key) return;
    discussStore.set({ threads: issues.filter(isHubIssue).map(toThread), loading: false, at: Date.now() });
  } catch (e) {
    discussStore.set({ loading: false, error: e });
  }
}
function upsert(issue) {
  const t = toThread(issue);
  const list = (discussStore.get().threads || []).filter((x) => x.number !== t.number);
  discussStore.set({ threads: [t, ...list] });
  return t;
}

// ------------------------------------------------------------- selectors
export function matchTarget(t, q) {
  if (!t || !q || t.type !== q.type) return false;
  switch (q.type) {
    case 'cell': return t.table === q.table && t.key === q.key && (q.column == null || t.column === q.column);
    case 'row': return t.table === q.table && t.key === q.key;
    case 'page': return t.page === q.page && (q.anchor == null || t.anchor === q.anchor);
    case 'asset': return t.asset === q.asset;
    default: return true;
  }
}
/** Threads about a target; for a row query also includes its cells. */
export function threadsFor(threads, q, { openOnly = false } = {}) {
  return (threads || []).filter((th) => (!openOnly || th.open) && (matchTarget(th.target, q) || (q.type === 'row' && th.target.type === 'cell' && th.target.table === q.table && th.target.key === q.key) || (q.type === 'table' && (th.target.type === 'cell' || th.target.type === 'row') && th.target.table === q.table)));
}

// ------------------------------------------------------------- titles
export function describeTarget(t) {
  if (!t) return 'General';
  const s = repoStore.get();
  switch (t.type) {
    case 'cell': case 'row': {
      const st = schemaTable(t.table);
      const label = st ? st.label || st.id : t.table;
      const col = st && t.column ? st.columns.find((c) => c.id === t.column) : null;
      return `${label} · ${rowName(t.table, t.key)}${col ? ' · ' + (col.label || col.id) : ''}`;
    }
    case 'page': { const p = s.pages.find((x) => x.id === t.page); return `Page · ${p ? p.title : t.page}${t.anchor ? ' § ' + t.anchor : ''}`; }
    case 'asset': { const a = s.assets.find((x) => x.id === t.asset); return `Asset · ${a ? a.name || a.id : t.asset}`; }
    default: return 'General';
  }
}
function proposalTitle(t) {
  const st = schemaTable(t.table);
  const col = st && st.columns.find((c) => c.id === t.column);
  const fmt = (v) => (col ? displayText(col, v, 30) : v);
  return `Proposal: ${rowName(t.table, t.key)} ${col ? col.label || col.id : t.column} ${fmt(t.from)} → ${fmt(t.to)}`;
}

// ------------------------------------------------------------- writes
/** Start a thread. target per §9 ({type:'cell'|'row'|'page'|'asset'|'general', …}). */
export async function createThread(target, { title, text }) {
  const { owner, repo, canPush } = repoStore.get();
  const proposal = target.type === 'cell' && target.to != null;
  const labels = proposal ? ['hub', 'hub:proposal'] : ['hub'];
  let withLabels = canPush;
  if (canPush) withLabels = await G.ensureLabels(owner, repo, labels).catch(() => false);
  const t = title || (proposal ? proposalTitle(target) : `${describeTarget(target)}: ${String(text || '').split('\n')[0].slice(0, 60) || 'Comment'}`);
  const issue = await G.createIssue(owner, repo, { title: t, body: buildBody(target, text), ...(withLabels ? { labels } : {}) });
  return upsert(issue);
}
export async function reply(number, text) {
  const { owner, repo } = repoStore.get();
  const c = await G.addComment(owner, repo, number, text);
  const th = (discussStore.get().threads || []).find((x) => x.number === number);
  if (th) upsert({ ...th.raw, comments: (th.raw.comments || 0) + 1, updated_at: new Date().toISOString() });
  return c;
}
export async function listReplies(number) {
  const { owner, repo } = repoStore.get();
  return G.listComments(owner, repo, number);
}
/** Close with hub:applied | hub:rejected | hub:resolved (labels only when the user may set labels). */
export async function closeThread(number, resolution, comment) {
  const { owner, repo, canPush } = repoStore.get();
  if (comment) await G.addComment(owner, repo, number, comment);
  const label = 'hub:' + resolution;
  const th = (discussStore.get().threads || []).find((x) => x.number === number);
  const existing = th ? th.labels : [];
  let body = { state: 'closed', state_reason: resolution === 'rejected' ? 'not_planned' : 'completed' };
  if (canPush && (await G.ensureLabels(owner, repo, [label]).catch(() => false))) body.labels = [...new Set([...existing, label])];
  const issue = await G.updateIssue(owner, repo, number, body);
  return upsert(issue);
}
export async function reopenThread(number) {
  const { owner, repo, canPush } = repoStore.get();
  const th = (discussStore.get().threads || []).find((x) => x.number === number);
  const body = { state: 'open' };
  if (canPush && th) body.labels = th.labels.filter((l) => !/^hub:(applied|rejected|resolved)$/.test(l));
  return upsert(await G.updateIssue(owner, repo, number, body));
}

/**
 * Apply a proposal (§9): a tuning commit whose note references #<issue>, then close with hub:applied.
 * Returns commitTuning's result ({status:'conflict', conflicts} when the cell moved on since the proposal).
 */
export async function applyProposal(thread, { note = '', force = false } = {}) {
  const t = thread.target;
  let from = t.from;
  if (force) {
    const { cellValue } = await import('./repo.js');
    from = cellValue(t.table, t.key, t.column);
  }
  const res = await commitTuning([{ table: t.table, key: t.key, column: t.column, from, to: t.to }], { note: `Applies #${thread.number}${note ? ' — ' + note : ''}` });
  if (res.status === 'saved' || res.status === 'nothing') {
    await closeThread(thread.number, 'applied', `Applied in ${res.sha ? res.sha.slice(0, 7) : 'a commit'} by @${(G.currentUser() || {}).login || 'someone'}.`);
  }
  return res;
}
