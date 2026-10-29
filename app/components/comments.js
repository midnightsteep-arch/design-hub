// Discussion threads for a target (page / page section / asset / row), shown inline: list, replies,
// reply box, new thread. Threads are GitHub issues (contract §9), via discuss.js.
import { html, cx, relTime, fullTime } from '../lib.js';
import { useEffect, useMemo, useRef, useState } from '../../vendor/hooks.module.js';
import { Icon } from '../icons.js';
import { useStore } from '../store.js';
import { repoStore } from '../repo.js';
import { discussStore, loadThreads, threadsFor, createThread, reply, listReplies } from '../discuss.js';
import { href } from '../router.js';
import { Avatar, Btn, AutoTextarea, SkeletonLines, ErrorPanel } from './ui.js';
import { MarkdownView } from './markdownview.js';
import { toast } from './toast.js';

export const STATE_LABEL = { open: 'Open', applied: 'Applied', rejected: 'Rejected', resolved: 'Resolved' };
const STATE_ICON = { open: 'comment', applied: 'check', rejected: 'x', resolved: 'check' };
export function StatePill({ state, size }) {
  return html`<span class=${cx('pg-state', 'pg-state-' + state, size === 'sm' && 'pg-state-sm')}><${Icon} name=${STATE_ICON[state] || 'comment'} size=${size === 'sm' ? 10 : 12} />${STATE_LABEL[state] || state}</span>`;
}

/** Discussion text (issue bodies, replies): sanitized markdown without directives. */
export function SafeMarkdown({ text, class: cls }) {
  return html`<${MarkdownView} body=${text} safe=${true} class=${cx('pg-safe-md', cls)} />`;
}

function targetFor(targetType, targetId, target) {
  if (target) return target;
  switch (targetType) {
    case 'page': return { type: 'page', page: targetId };
    case 'asset': return { type: 'asset', asset: targetId };
    case 'table': return { type: 'table', table: targetId };
    default: return { type: targetType || 'general' };
  }
}

// ---------------------------------------------------------------- replies
/** Replies of one thread + reply box. */
export function ThreadReplies({ number, open = true, onPosted, compact, autoFocus }) {
  const [list, setList] = useState(null);
  const [error, setError] = useState(null);
  const load = () => listReplies(number).then((r) => { setList(r || []); setError(null); }).catch(setError);
  useEffect(() => { setList(null); load(); }, [number]);
  return html`<div class=${cx('pg-replies', compact && 'is-compact')}>
    ${error && !list ? html`<${ErrorPanel} error=${error} onRetry=${load} compact />`
      : !list ? html`<${SkeletonLines} lines=${2} />`
      : list.length > 0 && html`<ul class="comment-list pg-reply-list">${list.map((c) => html`<li class="comment" key=${c.id}>
          <${Avatar} actor=${c.user ? c.user.login : 'someone'} size=${compact ? 20 : 24} />
          <div class="comment-main">
            <div class="comment-head"><span class="comment-author">${c.user ? c.user.login : 'someone'}</span>
              <time class="muted" title=${fullTime(Date.parse(c.created_at))}>${relTime(Date.parse(c.created_at))}</time></div>
            <${SafeMarkdown} text=${c.body} class="comment-body" />
          </div>
        </li>`)}</ul>`}
    <${ReplyBox} number=${number} closed=${!open} autoFocus=${autoFocus} onPosted=${(c) => { setList((l) => [...(l || []), c]); onPosted && onPosted(c); }} />
  </div>`;
}

export function ReplyBox({ number, closed, onPosted, autoFocus, placeholder }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const ref = useRef(null);
  useEffect(() => { if (autoFocus && ref.current) ref.current.focus(); }, []);
  const send = async (e) => {
    e && e.preventDefault();
    const t = text.trim();
    if (!t || busy) return;
    setBusy(true);
    try {
      const c = await reply(number, t);
      setText('');
      onPosted && onPosted(c);
    } catch (err) { toast("Couldn't post your reply", { kind: 'error', detail: err.message }); }
    setBusy(false);
  };
  return html`<form class="comment-form pg-reply-form" onSubmit=${send}>
    <${AutoTextarea} inputRef=${ref} value=${text} minRows=${2} maxRows=${10} class="input textarea"
      placeholder=${placeholder || (closed ? 'Reply (this discussion is closed)…' : 'Write a reply…  (Ctrl+Enter to send)')}
      onInput=${(e) => setText(e.currentTarget.value)} aria-label="Reply"
      onKeyDown=${(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) send(e); }} />
    <div class="comment-form-row">
      <span class="muted">Markdown works · visible to everyone on the project</span>
      <span class="spacer"></span>
      <${Btn} kind="primary" size="sm" type="submit" disabled=${!text.trim() || busy} loading=${busy} icon="send">Reply<//>
    </div>
  </form>`;
}

// ---------------------------------------------------------------- one thread, inline
function ThreadItem({ th, anchorTitle, expanded: expanded0, onAnchor }) {
  const [expanded, setExpanded] = useState(!!expanded0);
  const [n, setN] = useState(th.comments);
  useEffect(() => { setN(th.comments); }, [th.comments]);
  useEffect(() => { if (expanded0) setExpanded(true); }, [expanded0]);
  const at = Date.parse(th.created_at);
  return html`<li class=${cx('pg-thread', !th.open && 'is-closed', expanded && 'is-expanded')} data-thread=${th.number}>
    <div class="pg-thread-head">
      <${Avatar} actor=${th.user} size=${22} />
      <span class="comment-author">${th.user}</span>
      <time class="muted" title=${fullTime(at)}>${relTime(at)}</time>
      ${!th.open && html`<${StatePill} state=${th.state} size="sm" />`}
      <span class="spacer"></span>
      <a class="icon-btn icon-btn-sm" href=${href.discussions(th.number)} title="Open the full discussion" aria-label="Open the full discussion"><${Icon} name="arrow-up-right" size=${13} /></a>
    </div>
    ${th.target && th.target.anchor && html`<button type="button" class="pg-anchor-chip" onClick=${() => onAnchor && onAnchor(th.target.anchor)} title="Go to this section">
      <${Icon} name="hash" size=${11} />${anchorTitle || th.target.anchor}</button>`}
    <div class="pg-thread-title">${th.title}</div>
    ${th.text && html`<${SafeMarkdown} text=${th.text} class="comment-body" />`}
    <button type="button" class="link-btn pg-thread-toggle" aria-expanded=${String(expanded)} onClick=${() => setExpanded(!expanded)}>
      <${Icon} name=${expanded ? 'chevron-down' : 'chevron-right'} size=${12} />
      ${n ? `${n} repl${n === 1 ? 'y' : 'ies'}` : 'Reply'}
    </button>
    ${expanded && html`<${ThreadReplies} number=${th.number} open=${th.open} compact onPosted=${() => setN((x) => x + 1)} />`}
  </li>`;
}

/**
 * Threads about a target, with a "new comment" form.
 * props: targetType ('page'|'asset'|'table'|…) + targetId, or target (a §9 target object);
 *        anchors [{id, text}] (page sections the new comment can be about), focusAnchor (expand + show those first),
 *        onCount(openCount), onAnchor(anchor) (jump to a section), compact, inputRef.
 */
export function Comments({ targetType, targetId, target, anchors, focusAnchor, onCount, onAnchor, compact, inputRef }) {
  const q = useMemo(() => targetFor(targetType, targetId, target), [targetType, targetId, target]);
  const threads = useStore(discussStore, (s) => s.threads);
  const loading = useStore(discussStore, (s) => s.loading);
  const error = useStore(discussStore, (s) => s.error);
  const [showClosed, setShowClosed] = useState(false);
  const [text, setText] = useState('');
  const [anchor, setAnchor] = useState(focusAnchor || '');
  const [busy, setBusy] = useState(false);
  useEffect(() => { loadThreads(); }, []);
  useEffect(() => { if (focusAnchor) setAnchor(focusAnchor); }, [focusAnchor]);
  const all = threadsFor(threads || [], q);
  const sortKey = (t) => (focusAnchor && t.target.anchor === focusAnchor ? 0 : 1);
  const open = all.filter((t) => t.open).sort((a, b) => sortKey(a) - sortKey(b) || Date.parse(b.updated_at) - Date.parse(a.updated_at));
  const closed = all.filter((t) => !t.open);
  useEffect(() => { if (onCount && threads) onCount(open.length); }, [threads, open.length]);
  const anchorTitle = (id) => { const a = (anchors || []).find((x) => x.id === id); return a ? a.text : id; };

  const add = async (e) => {
    e && e.preventDefault();
    const t = text.trim();
    if (!t || busy) return;
    setBusy(true);
    try {
      const tgt = { ...q };
      let title;
      if (q.type === 'page') {
        delete tgt.anchor;
        if (anchor) tgt.anchor = anchor;
        const pg = repoStore.get().pages.find((p) => p.id === q.page);
        const snippet = t.split('\n')[0].replace(/[*_`#>[\]]/g, '').trim();
        title = `${pg ? pg.title : q.page}${anchor ? ' › ' + anchorTitle(anchor) : ''}: ${snippet.length > 60 ? snippet.slice(0, 59) + '…' : snippet || 'Comment'}`;
      }
      await createThread(tgt, { text: t, title });
      setText('');
      toast('Comment posted', { kind: 'success' });
    } catch (err) { toast("Couldn't post the comment", { kind: 'error', detail: err.message }); }
    setBusy(false);
  };

  return html`<div class=${cx('comments', 'pg-comments', compact && 'comments-compact')}>
    ${error && !threads ? html`<${ErrorPanel} error=${error} onRetry=${() => loadThreads({ force: true })} compact />`
      : !threads ? html`<${SkeletonLines} lines=${3} />`
      : html`<div>
        ${open.length === 0 && html`<p class="muted comments-empty">No open comments. Questions and review feedback go here — everyone on the project can see them.</p>`}
        <ul class="pg-thread-list">${open.map((th) => html`<${ThreadItem} key=${th.number} th=${th} anchorTitle=${th.target.anchor ? anchorTitle(th.target.anchor) : null}
          expanded=${focusAnchor && th.target.anchor === focusAnchor} onAnchor=${onAnchor} />`)}</ul>
        ${closed.length > 0 && html`<button type="button" class="link-btn comments-toggle" onClick=${() => setShowClosed(!showClosed)} aria-expanded=${String(showClosed)}>
          <${Icon} name=${showClosed ? 'chevron-down' : 'chevron-right'} size=${12} /> ${closed.length} closed</button>`}
        ${showClosed && html`<ul class="pg-thread-list">${closed.map((th) => html`<${ThreadItem} key=${th.number} th=${th} anchorTitle=${th.target.anchor ? anchorTitle(th.target.anchor) : null} onAnchor=${onAnchor} />`)}</ul>`}
        ${loading && html`<span class="spinner spinner-sm" aria-label="Refreshing"></span>`}
      </div>`}
    <form class="comment-form pg-new-comment" onSubmit=${add}>
      <div class="pg-new-head">New comment</div>
      ${q.type === 'page' && anchors && anchors.length > 0 && html`<label class="pg-anchor-pick">
        <span class="label-sm">About</span>
        <span class="select-wrap">
          <select class="select select-sm" value=${anchor} onChange=${(e) => setAnchor(e.currentTarget.value)} aria-label="Section this comment is about">
            <option value="">The whole page</option>
            ${anchors.map((a) => html`<option key=${a.id} value=${a.id}>${a.depth > 2 ? '— ' : ''}${a.text}</option>`)}
          </select>
          <${Icon} name="chevron-down" size=${14} class="select-caret" />
        </span>
      </label>`}
      <${AutoTextarea} inputRef=${inputRef} value=${text} minRows=${3} maxRows=${12} class="input textarea" placeholder="Write a comment…  (Ctrl+Enter to send)"
        onInput=${(e) => setText(e.currentTarget.value)} aria-label="New comment"
        onKeyDown=${(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) add(e); }} />
      <div class="comment-form-row">
        <span class="muted">Starts a discussion everyone on the project can see</span>
        <span class="spacer"></span>
        <${Btn} kind="primary" size="sm" type="submit" disabled=${!text.trim() || busy} loading=${busy} icon="send">Comment<//>
      </div>
    </form>
  </div>`;
}
