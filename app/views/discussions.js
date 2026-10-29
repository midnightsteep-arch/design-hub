// Discussions (contract §9): every comment thread and value proposal = a GitHub issue labelled hub.
// List (filters Open · Proposals · Closed, type, search) and single thread (target card, body, replies,
// Resolve / Reopen, Apply / Reject for proposals).
import { html, cx, relTime, fullTime } from '../lib.js';
import { useEffect, useMemo, useState } from '../../vendor/hooks.module.js';
import { Icon } from '../icons.js';
import { useStore } from '../store.js';
import { repoStore, schemaTable, rowName, cellValue, assetById, reloadRepo } from '../repo.js';
import { discussStore, loadThreads, describeTarget, createThread, closeThread, reopenThread, applyProposal } from '../discuss.js';
import { displayText } from '../canon.js';
import { href, navigate, setQuery } from '../router.js';
import { Modal, confirmDialog } from '../components/overlay.js';
import { toast } from '../components/toast.js';
import { EmptyState, ErrorPanel, SkeletonLines, Btn, LinkBtn, Avatar, AutoTextarea, IconBtn } from '../components/ui.js';
import { StatePill, SafeMarkdown, ThreadReplies } from '../components/comments.js';

const isProposal = (t) => t.target && t.target.type === 'cell' && t.target.to != null;
const TYPE_OPTS = [
  { id: '', label: 'All types' }, { id: 'cell', label: 'Values' }, { id: 'row', label: 'Rows' },
  { id: 'page', label: 'Pages' }, { id: 'asset', label: 'Assets' }, { id: 'general', label: 'General' },
];
const TYPE_ICON = { cell: 'sliders', row: 'table', page: 'file-text', asset: 'image', general: 'comment' };

/** Where a thread's target lives in the app (null for general threads). */
export function targetHref(t) {
  if (!t) return null;
  switch (t.type) {
    case 'cell': case 'row': return href.tuning(t.table, { row: t.key });
    case 'page': return href.page(t.page, t.anchor ? { h: t.anchor } : undefined);
    case 'asset': { const a = assetById(t.asset); return href.asset(t.asset, a ? a.group : undefined); }
    default: return null;
  }
}

function colOf(t) {
  const st = schemaTable(t.table);
  return st ? st.columns.find((c) => c.id === t.column) || null : null;
}
/** describeTarget, with a page section shown as its heading text rather than its anchor id. */
export function describe(t) {
  if (t && t.type === 'page' && t.anchor) {
    const p = repoStore.get().pages.find((x) => x.id === t.page);
    const words = String(t.anchor).replace(/-\d+$/, '').replace(/-/g, ' ');
    return `Page · ${p ? p.title : t.page} › ${words.charAt(0).toUpperCase() + words.slice(1)}`;
  }
  return describeTarget(t);
}
const show = (col, v) => (v == null ? '(empty)' : col ? displayText(col, v, 60) : String(v));

// ---------------------------------------------------------------- list
function ThreadRow({ th }) {
  const t = th.target;
  const to = targetHref(t);
  const at = Date.parse(th.updated_at || th.created_at);
  return html`<li class=${cx('pg-dl-item', !th.open && 'is-closed')}>
    <span class=${cx('pg-dl-icon', isProposal(th) && 'is-proposal')}><${Icon} name=${isProposal(th) ? 'flag' : TYPE_ICON[t.type] || 'comment'} size=${15} /></span>
    <div class="pg-dl-main">
      <a class="pg-dl-title" href=${href.discussions(th.number)}>${th.title}</a>
      <div class="pg-dl-meta muted">
        ${t.type !== 'general' && (to ? html`<a href=${to} class="pg-dl-target">${describe(t)}</a>` : html`<span>${describe(t)}</span>`)}
        ${t.type !== 'general' && html`<span aria-hidden="true">·</span>`}
        <span>#${th.number} by <b>${th.user}</b></span>
        <span aria-hidden="true">·</span>
        <time title=${fullTime(at)}>${relTime(at)}</time>
      </div>
    </div>
    <div class="pg-dl-side">
      ${th.comments > 0 && html`<span class="pg-dl-replies" title=${`${th.comments} repl${th.comments === 1 ? 'y' : 'ies'}`}><${Icon} name="comment" size=${12} />${th.comments}</span>`}
      <${StatePill} state=${th.state} size="sm" />
    </div>
  </li>`;
}

function NewDiscussion({ onClose }) {
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e && e.preventDefault();
    if (!title.trim() || busy) return;
    setBusy(true);
    try {
      const th = await createThread({ type: 'general' }, { title: title.trim(), text });
      toast('Discussion started', { kind: 'success' });
      onClose();
      navigate(href.discussions(th.number));
    } catch (err) { toast("Couldn't start the discussion", { kind: 'error', detail: err.message }); setBusy(false); }
  };
  return html`<${Modal} title="New discussion" onClose=${onClose} size="md"
    footer=${html`<${Btn} kind="ghost" onClick=${onClose}>Cancel<//><${Btn} kind="primary" icon="send" onClick=${submit} disabled=${!title.trim() || busy} loading=${busy}>Start discussion<//>`}>
    <form class="pg-new-disc" onSubmit=${submit}>
      <label class="field"><span class="label-sm">Title</span>
        <input class="input" value=${title} data-autofocus maxLength=${200} onInput=${(e) => setTitle(e.currentTarget.value)} placeholder="e.g. Should spells be sold back at shops?" /></label>
      <label class="field"><span class="label-sm">Details <span class="muted">(markdown works)</span></span>
        <${AutoTextarea} value=${text} minRows=${5} maxRows=${14} onInput=${(e) => setText(e.currentTarget.value)}
          onKeyDown=${(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submit(e); }} /></label>
      <p class="muted pg-small">To comment on a page section, a value or an asset, use the comment button next to it instead — the discussion then links back to it.</p>
    </form>
  <//>`;
}

function DiscussionList({ query }) {
  const threads = useStore(discussStore, (s) => s.threads);
  const loading = useStore(discussStore, (s) => s.loading);
  const error = useStore(discussStore, (s) => s.error);
  const [creating, setCreating] = useState(false);
  const f = ['open', 'proposals', 'closed'].includes(query.f) ? query.f : 'open';
  const type = query.type || '';
  const [q, setQ] = useState(query.q || '');
  useEffect(() => { loadThreads({ force: true }); }, []);
  useEffect(() => { const t = setTimeout(() => { if ((query.q || '') !== q) setQuery({ q: q || null }); }, 250); return () => clearTimeout(t); }, [q]);
  const all = threads || [];
  const byTable = query.table ? all.filter((t) => t.target.table === query.table) : all;
  const byType = type ? byTable.filter((t) => t.target.type === type) : byTable;
  const needle = q.trim().toLowerCase();
  const searched = needle ? byType.filter((t) => (t.title + ' ' + t.text + ' ' + describe(t.target) + ' ' + t.user + ' #' + t.number).toLowerCase().includes(needle)) : byType;
  const counts = { open: searched.filter((t) => t.open).length, proposals: searched.filter((t) => t.open && isProposal(t)).length, closed: searched.filter((t) => !t.open).length };
  const list = searched.filter((t) => (f === 'open' ? t.open : f === 'proposals' ? t.open && isProposal(t) : !t.open))
    .sort((a, b) => Date.parse(b.updated_at || b.created_at) - Date.parse(a.updated_at || a.created_at));
  const tabs = [{ id: 'open', label: 'Open' }, { id: 'proposals', label: 'Proposals' }, { id: 'closed', label: 'Closed' }];
  return html`<div class="container container-narrow pg-disc">
    <header class="page-head">
      <div class="page-head-main">
        <h1 class="page-title">Discussions</h1>
        <div class="page-sub">Comments and proposed value changes from the whole team. Each one is a GitHub issue in the game's repo.</div>
      </div>
      <div class="page-head-actions">
        <${IconBtn} icon="refresh" label="Refresh" onClick=${() => loadThreads({ force: true })} disabled=${loading} class=${loading ? 'is-spinning' : ''} />
        <${Btn} kind="primary" size="sm" icon="plus" onClick=${() => setCreating(true)}>New discussion<//>
      </div>
    </header>
    ${query.table && html`<div class="pg-filter-chips"><span class="chip is-active">Table: ${query.table}<button type="button" class="chip-x" aria-label="Clear table filter" onClick=${() => setQuery({ table: null })}>×</button></span></div>`}
    <div class="filter-row pg-disc-filters">
      <div class="chips" role="radiogroup" aria-label="Show">
        ${tabs.map((t) => html`<button type="button" key=${t.id} role="radio" aria-checked=${String(f === t.id)} class=${cx('chip', f === t.id && 'is-active')}
          onClick=${() => setQuery({ f: t.id === 'open' ? null : t.id })}>${t.label}<span class="chip-n">${threads ? counts[t.id] : '…'}</span></button>`)}
      </div>
      <span class="spacer"></span>
      <label class="select-wrap">
        <select class="select select-sm" value=${type} onChange=${(e) => setQuery({ type: e.currentTarget.value || null })} aria-label="Type">
          ${TYPE_OPTS.map((o) => html`<option key=${o.id} value=${o.id}>${o.label}</option>`)}
        </select>
        <${Icon} name="chevron-down" size=${14} class="select-caret" />
      </label>
      <label class="search-mini pg-disc-search">
        <${Icon} name="search" size=${14} />
        <input class="input input-sm" type="search" value=${q} placeholder="Search" aria-label="Search discussions" onInput=${(e) => setQ(e.currentTarget.value)} />
      </label>
    </div>
    ${error && !threads ? html`<${ErrorPanel} error=${error} title="Couldn't load the discussions" onRetry=${() => loadThreads({ force: true })} />`
      : !threads ? html`<${SkeletonLines} lines=${8} />`
      : !list.length ? html`<${EmptyState} icon="comment" title=${needle || type ? 'Nothing matches these filters' : f === 'closed' ? 'No closed discussions yet' : f === 'proposals' ? 'No open proposals' : 'No open discussions'}>
          ${needle || type ? 'Try another filter or search.' : f === 'proposals' ? 'Propose a value from any tuning table: the proposal shows up here for someone with edit access to apply.' : 'Start one with “New discussion”, or comment on a page section, value or asset.'}<//>`
      : html`<ul class="pg-dl">${list.map((th) => html`<${ThreadRow} key=${th.number} th=${th} />`)}</ul>`}
    ${creating && html`<${NewDiscussion} onClose=${() => setCreating(false)} />`}
  </div>`;
}

// ---------------------------------------------------------------- single thread
function ProposalCard({ th }) {
  const t = th.target;
  useStore(repoStore, (s) => s.version);
  const st = schemaTable(t.table);
  const col = colOf(t);
  const cur = cellValue(t.table, t.key, t.column);
  const moved = th.open && cur !== null && cur !== t.from;
  return html`<div class="pg-target pg-target-proposal">
    <div class="pg-target-kind"><${Icon} name="flag" size=${13} /> Proposed change</div>
    <div class="pg-target-what">
      <a href=${href.tuning(t.table, { row: t.key })}>${st ? st.label || st.id : t.table} · <b>${rowName(t.table, t.key)}</b> · ${col ? col.label || col.id : t.column}</a>
    </div>
    <div class="pg-prop-vals">
      <div class="pg-prop-v"><span class="label-sm">From</span><span class="pg-val mono">${show(col, t.from)}</span></div>
      <${Icon} name="arrow-right" size=${16} class="muted" />
      <div class="pg-prop-v is-to"><span class="label-sm">To</span><span class="pg-val mono">${show(col, t.to)}</span></div>
      ${cur !== null && html`<div class="pg-prop-v is-now"><span class="label-sm">Now</span><span class="pg-val mono">${show(col, cur)}</span></div>`}
    </div>
    ${cur === null && html`<div class="note note-warn pg-prop-warn"><${Icon} name="alert" size=${14} /><span>This value no longer exists in the tuning tables (the row or column was removed in the game).</span></div>`}
    ${moved && html`<div class="note note-warn pg-prop-warn"><${Icon} name="alert" size=${14} /><span>The value has changed since this was proposed: it is <b>${show(col, cur)}</b> now, not ${show(col, t.from)}.</span></div>`}
  </div>`;
}

function TargetCard({ th }) {
  const t = th.target;
  if (isProposal(th)) return html`<${ProposalCard} th=${th} />`;
  if (t.type === 'general') return null;
  const to = targetHref(t);
  return html`<div class="pg-target">
    <div class="pg-target-kind"><${Icon} name=${TYPE_ICON[t.type] || 'comment'} size=${13} /> ${t.type === 'page' ? (t.anchor ? 'About a page section' : 'About a page') : t.type === 'asset' ? 'About an asset' : t.type === 'cell' ? 'About a value' : 'About a row'}</div>
    <div class="pg-target-what">${to ? html`<a href=${to}>${describe(t)}</a>` : describe(t)}</div>
    ${t.type === 'cell' && (() => { const col = colOf(t); const cur = cellValue(t.table, t.key, t.column); return cur !== null && html`<div class="muted pg-small">Current value: <b class="mono">${show(col, cur)}</b></div>`; })()}
  </div>`;
}

function RejectDialog({ th, onClose, onDone }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try { await closeThread(th.number, 'rejected', text.trim() || undefined); toast('Proposal rejected', { kind: 'success' }); onDone(); onClose(); }
    catch (e) { toast("Couldn't reject the proposal", { kind: 'error', detail: e.message }); setBusy(false); }
  };
  return html`<${Modal} title="Reject this proposal?" onClose=${onClose} size="sm"
    footer=${html`<${Btn} kind="ghost" onClick=${onClose}>Cancel<//><${Btn} kind="danger" icon="x" onClick=${go} loading=${busy}>Reject<//>`}>
    <p class="confirm-text">The value stays as it is and the discussion is closed. Say why, so ${th.user} knows:</p>
    <${AutoTextarea} value=${text} minRows=${3} maxRows=${10} data-autofocus placeholder="Optional reason" onInput=${(e) => setText(e.currentTarget.value)} />
  <//>`;
}

function ThreadView({ number }) {
  const threads = useStore(discussStore, (s) => s.threads);
  const error = useStore(discussStore, (s) => s.error);
  const canPush = useStore(repoStore, (s) => s.canPush);
  const [busy, setBusy] = useState(null);
  const [rejecting, setRejecting] = useState(false);
  const [repliesKey, setRepliesKey] = useState(0);
  useEffect(() => { loadThreads(); }, []);
  const th = (threads || []).find((t) => t.number === number);
  if (error && !threads) return html`<div class="container container-narrow"><${ErrorPanel} error=${error} onRetry=${() => loadThreads({ force: true })} /></div>`;
  if (!threads) return html`<div class="container container-narrow"><${SkeletonLines} lines=${8} /></div>`;
  if (!th) {
    return html`<div class="container container-narrow"><${EmptyState} icon="comment" title=${`Discussion #${number} not found`}>
      It may not be a Design Hub discussion. <a href=${href.discussions()}>All discussions</a><//></div>`;
  }
  const proposal = isProposal(th);
  const act = async (name, fn) => {
    setBusy(name);
    try { await fn(); } catch (e) {
      const msg = e && e.status === 403 ? 'Only the person who started this discussion, or someone with edit access, can do that.' : (e && e.message) || String(e);
      toast(msg, { kind: 'error' });
    }
    setBusy(null);
  };
  const resolve = () => act('resolve', async () => { await closeThread(th.number, 'resolved'); toast('Marked as resolved', { kind: 'success' }); });
  const reopen = () => act('reopen', async () => { await reopenThread(th.number); toast('Reopened', { kind: 'success' }); });
  const apply = () => act('apply', async () => {
    let res = await applyProposal(th);
    if (res.status === 'conflict') {
      // load the latest version first, so "now" is the real current value and a forced apply starts from it
      try { await reloadRepo(); } catch (e) { /* offline: fall back to what the conflict reported */ }
      const col = colOf(th.target);
      const now = cellValue(th.target.table, th.target.key, th.target.column) ?? (res.conflicts && res.conflicts[0] && res.conflicts[0].current);
      const ok = await confirmDialog({ title: 'The value has changed', message: `The value has changed since this was proposed (now ${show(col, now)}). Apply ${show(col, th.target.to)} anyway?`, confirmLabel: 'Apply anyway' });
      if (!ok) return;
      res = await applyProposal(th, { force: true });
    }
    if (res.status === 'conflict') { toast('The value changed again — reload and try once more.', { kind: 'error' }); return; }
    toast(res.status === 'nothing' ? 'The value was already set — discussion closed as applied.' : 'Applied — the new value is saved', { kind: 'success' });
    setRepliesKey((k) => k + 1);
  });
  const created = Date.parse(th.created_at);
  return html`<div class="container container-narrow pg-thread-view">
    <a class="pg-back" href=${href.discussions()}><${Icon} name="arrow-left" size=${14} /> All discussions</a>
    <header class="pg-th-head">
      <h1 class="page-title pg-th-title">${th.title} <span class="pg-th-num muted">#${th.number}</span></h1>
      <div class="pg-th-meta">
        <${StatePill} state=${th.state} />
        <span class="muted"><b>${th.user}</b> started this <time title=${fullTime(created)}>${relTime(created)}</time> · ${th.comments} repl${th.comments === 1 ? 'y' : 'ies'}</span>
      </div>
    </header>
    <${TargetCard} th=${th} />
    <div class="pg-th-actions">
      ${proposal && th.open && canPush && html`<${Btn} kind="primary" icon="check" onClick=${apply} loading=${busy === 'apply'} disabled=${!!busy}>Apply<//>
        <${Btn} kind="danger-ghost" icon="x" onClick=${() => setRejecting(true)} disabled=${!!busy}>Reject<//>`}
      ${th.open ? html`<${Btn} kind="secondary" icon="check" onClick=${resolve} loading=${busy === 'resolve'} disabled=${!!busy}>Resolve<//>`
        : html`<${Btn} kind="secondary" icon="undo" onClick=${reopen} loading=${busy === 'reopen'} disabled=${!!busy}>Reopen<//>`}
      <span class="spacer"></span>
      ${th.html_url && html`<${LinkBtn} kind="ghost" size="sm" icon="github" href=${th.html_url} target="_blank" rel="noopener noreferrer">View on GitHub<//>`}
    </div>
    ${proposal && th.open && !canPush && html`<p class="muted pg-small">Someone with edit access applies or rejects proposals.</p>`}
    <section class="pg-th-body">
      <div class="comment pg-th-first">
        <${Avatar} actor=${th.user} size=${28} />
        <div class="comment-main">
          <div class="comment-head"><span class="comment-author">${th.user}</span><time class="muted" title=${fullTime(created)}>${relTime(created)}</time></div>
          ${th.text.trim() ? html`<${SafeMarkdown} text=${th.text} class="comment-body" />` : html`<p class="muted">No description.</p>`}
        </div>
      </div>
      <${ThreadReplies} key=${repliesKey} number=${th.number} open=${th.open} />
    </section>
    ${rejecting && html`<${RejectDialog} th=${th} onClose=${() => setRejecting(false)} onDone=${() => setRepliesKey((k) => k + 1)} />`}
  </div>`;
}

export function DiscussionsView({ number, query = {} }) {
  if (number) return html`<${ThreadView} key=${number} number=${number} />`;
  return html`<${DiscussionList} query=${query} />`;
}
