// Discussion panel for one asset (contract §9: threads are GitHub issues with an {"type":"asset"} target).
// Lists the asset's threads (open first) linking to the Discussions section, plus a Comment box that starts a thread.
// Read-only users may comment too.
import { html, cx, relTime, fullTime, modKey, truncate } from '../lib.js';
import { useState } from '../../vendor/hooks.module.js';
import { Icon } from '../icons.js';
import { useStore } from '../store.js';
import { href } from '../router.js';
import { discussStore, threadsFor, createThread, loadThreads } from '../discuss.js';
import { Avatar, AutoTextarea, SkeletonLines, Btn, ErrorPanel } from '../components/ui.js';
import { toast } from '../components/toast.js';

const STATE = { open: ['Open', 'accent'], applied: ['Applied', 'ok'], rejected: ['Rejected', 'bad'], resolved: ['Resolved', 'neutral'] };

export function openThreadCount(threads, assetId) {
  return threadsFor(threads, { type: 'asset', asset: assetId }, { openOnly: true }).length;
}

export function AssetDiscussion({ asset, inputRef }) {
  const threads = useStore(discussStore, (s) => s.threads);
  const loading = useStore(discussStore, (s) => s.loading);
  const error = useStore(discussStore, (s) => s.error);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [showClosed, setShowClosed] = useState(false);
  const all = threadsFor(threads, { type: 'asset', asset: asset.id });
  const open = all.filter((t) => t.open);
  const closed = all.filter((t) => !t.open);
  const send = async () => {
    const t = text.trim();
    if (!t || busy) return;
    setBusy(true);
    try {
      const th = await createThread({ type: 'asset', asset: asset.id }, { text: t });
      setText('');
      toast('Comment posted', { kind: 'success', duration: 2500, action: { label: `Open #${th.number}`, run: () => { location.hash = href.discussions(th.number); } } });
    } catch (e) {
      toast("Couldn't post the comment", { kind: 'error', detail: (e && e.message) || String(e) });
    } finally { setBusy(false); }
  };
  const item = (th) => {
    const st = STATE[th.state] || STATE.resolved;
    const at = Date.parse(th.created_at);
    return html`<li key=${th.number}>
      <a class=${cx('as-thread', !th.open && 'is-closed')} href=${href.discussions(th.number)}>
        <${Avatar} actor=${th.user} size=${22} />
        <span class="as-thread-main">
          <span class="as-thread-title">${truncate(th.text ? th.text.split('\n')[0] : th.title, 140)}</span>
          <span class="as-thread-meta muted">#${th.number} · ${th.user} · <time title=${fullTime(at)}>${relTime(at)}</time>${th.comments ? ` · ${th.comments} repl${th.comments === 1 ? 'y' : 'ies'}` : ''}</span>
        </span>
        <span class=${'badge badge-' + st[1]}>${st[0]}</span>
      </a>
    </li>`;
  };
  return html`<div class="as-discuss">
    ${error && !threads ? html`<${ErrorPanel} error=${error} compact title="Couldn't load discussions" onRetry=${() => loadThreads({ force: true })} />`
      : !threads && loading ? html`<${SkeletonLines} lines=${3} />`
      : !all.length ? html`<p class="muted as-discuss-empty">No discussion about this asset yet.</p>`
      : html`<ul class="as-thread-list">${open.map(item)}</ul>
        ${closed.length > 0 && html`<button type="button" class="link-btn as-closed-toggle" onClick=${() => setShowClosed(!showClosed)}>
          ${showClosed ? 'Hide' : 'Show'} ${closed.length} closed</button>
          ${showClosed && html`<ul class="as-thread-list">${closed.map(item)}</ul>`}`}`}
    <div class="comment-form as-comment-form">
      <${AutoTextarea} inputRef=${inputRef} value=${text} minRows=${2} maxRows=${8} placeholder="Start a discussion about this asset…"
        aria-label="Comment on this asset" onInput=${(e) => setText(e.currentTarget.value)}
        onKeyDown=${(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); } }} />
      <div class="comment-form-row">
        <span class="muted as-hint">${modKey}+Enter to post · visible to everyone with access</span>
        <span class="spacer"></span>
        <${Btn} kind="primary" size="sm" icon="comment" loading=${busy} disabled=${!text.trim() || busy} onClick=${send}>Comment<//>
      </div>
    </div>
  </div>`;
}

export function ThreadBadge({ n, href: to, name }) {
  return html`<a class=${cx('comment-bubble', n > 0 && 'has')} href=${to} title=${n ? `${n} open discussion${n === 1 ? '' : 's'}` : 'Discuss'}
    aria-label=${`${n || 0} open discussions about ${name}`}>
    <${Icon} name="comment" size=${13} />${n > 0 && html`<span>${n}</span>`}
  </a>`;
}
