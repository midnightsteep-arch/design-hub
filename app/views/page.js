// Page view (route #/<o>/<r>/page/<id>, query h = heading anchor): header with last editor, Comments /
// History / Edit actions, rendered markdown with directive islands, TOC rail with scrollspy, section
// discussion badges, the editor (canPush only).
import { html, cx, relTime, fullTime } from '../lib.js';
import { useEffect, useMemo, useRef, useState } from '../../vendor/hooks.module.js';
import { Icon } from '../icons.js';
import { useStore } from '../store.js';
import * as G from '../github.js';
import { repoStore, loadPage, pagePath } from '../repo.js';
import { discussStore, threadsFor, loadThreads } from '../discuss.js';
import { parseCommitMessage } from '../commitmsg.js';
import { href } from '../router.js';
import { MarkdownView, Toc, scrollToHeading } from '../components/markdownview.js';
import { PageEditor, PageHistoryDrawer } from '../components/editor.js';
import { Comments } from '../components/comments.js';
import { Drawer } from '../components/overlay.js';
import { EmptyState, ErrorPanel, Skeleton, SkeletonLines, Btn, Avatar, useMediaQuery } from '../components/ui.js';
import { stripLeadingTitle, commitWho, commitTime } from '../pages/util.js';

function LastEdit({ path, head }) {
  const [c, setC] = useState(undefined);
  useEffect(() => {
    let alive = true;
    const s = repoStore.get();
    G.listCommits(s.owner, s.repo, { sha: s.branch, path, perPage: 1 })
      .then((r) => { if (alive) setC(r.commits[0] || null); }).catch(() => { if (alive) setC(null); });
    return () => { alive = false; };
  }, [path, head]);
  if (c === undefined) return html`<${Skeleton} w=${180} h=${11} />`;
  if (!c) return html`<span>Not saved yet</span>`;
  const m = parseCommitMessage(c.commit.message);
  const who = commitWho(c, m);
  const at = commitTime(c);
  return html`<span class="pg-lastedit"><${Avatar} actor=${who.actor} size=${18} />
    <span>Edited by <span class="who-name">${who.name}</span>${who.engine ? ` (${who.engine})` : ''} · <time title=${fullTime(at)} datetime=${new Date(at).toISOString()}>${relTime(at)}</time></span></span>`;
}

export function PageView({ id, query = {} }) {
  const meta = useStore(repoStore, (s) => s.pages.find((p) => p.id === id) || null);
  const head = useStore(repoStore, (s) => s.head);
  const canPush = useStore(repoStore, (s) => s.canPush);
  const threads = useStore(discussStore, (s) => s.threads);
  const wide = useMediaQuery('(min-width: 1240px)');
  const [doc, setDoc] = useState(null); // {text, sha, missing, path}
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(null); // base {text, sha, missing} when editing
  const [historyOpen, setHistoryOpen] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(null); // null | {anchor}
  const [headings, setHeadings] = useState([]);
  const [activeH, setActiveH] = useState(null);
  const scrolled = useRef(null);
  const path = meta ? pagePath(meta) : null;
  const base = meta ? href.page(id) : null;

  const load = () => {
    if (!meta) return;
    loadPage(id).then((d) => { setDoc(d); setError(null); }).catch(setError);
  };
  useEffect(() => { if (!editing) load(); }, [id, head, !!meta, !!editing]);
  useEffect(() => { loadThreads(); }, []);

  // deep link to a heading (?h=): scroll once per heading value
  useEffect(() => {
    if (!doc || editing || !query.h || scrolled.current === query.h) return undefined;
    const t = setTimeout(() => { if (scrollToHeading(query.h, false)) scrolled.current = query.h; }, 80);
    return () => clearTimeout(t);
  }, [doc, editing, query.h, headings]);
  useEffect(() => { if (editing) setHeadings([]); }, [editing]);

  const pageThreads = useMemo(() => threadsFor(threads || [], { type: 'page', page: id }), [threads, id]);
  const openThreads = pageThreads.filter((t) => t.open);
  const anchorCounts = useMemo(() => {
    const m = {};
    for (const t of openThreads) if (t.target.anchor) m[t.target.anchor] = (m[t.target.anchor] || 0) + 1;
    return m;
  }, [openThreads]);

  const showToc = wide && !editing && headings.filter((x) => x.depth === 2).length >= 3;
  // scrollspy for the TOC rail
  useEffect(() => {
    if (!showToc) return undefined;
    const els = headings.filter((x) => x.depth >= 2 && x.depth <= 3).map((x) => document.getElementById('h-' + x.id)).filter(Boolean);
    if (!els.length || !('IntersectionObserver' in window)) return undefined;
    const io = new IntersectionObserver((ents) => {
      const vis = ents.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      if (vis[0]) setActiveH(vis[0].target.getAttribute('data-heading'));
    }, { rootMargin: '-90px 0px -65% 0px' });
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
  }, [headings, showToc]);

  if (!meta) {
    return html`<div class="container container-narrow"><${EmptyState} icon="file-text" title="This page doesn't exist">
      It may have been renamed or removed from the project. <a href=${href.repo()}>Back to the project home</a><//></div>`;
  }
  if (error) return html`<div class="container container-narrow"><${ErrorPanel} error=${error} title="Couldn't load this page" onRetry=${load} /></div>`;
  if (!doc) {
    return html`<div class="pg-layout"><div class="pg-main"><${Skeleton} w=${300} h=${28} /><div style="height:10px"></div><${Skeleton} w=${200} h=${11} />
      <div style="height:24px"></div><${SkeletonLines} lines=${9} /></div></div>`;
  }
  if (editing) {
    return html`<div class="pg-layout pg-layout-edit"><div class="pg-main">
      <${PageEditor} key=${'ed' + (editing.sha || 'new')} page=${meta} path=${path} base=${editing}
        onDone=${() => setEditing(null)}
        onSaved=${() => { setEditing(null); load(); }} />
    </div></div>`;
  }
  const anchors = headings.filter((x) => x.depth >= 2 && x.depth <= 3);
  const body = stripLeadingTitle(doc.text, meta.title);
  return html`<div class=${cx('pg-layout', showToc && 'has-toc')}>
    <article class="pg-main page">
      <header class="page-header pg-header">
        <div class="page-header-main">
          <div class="eyebrow pg-eyebrow">${meta.tabTitle}</div>
          <h1 class="page-title">${meta.title}</h1>
          <div class="page-meta muted"><${LastEdit} path=${path} head=${head} /></div>
        </div>
        <div class="page-actions">
          <${Btn} size="sm" kind="ghost" icon="comment" onClick=${() => setCommentsOpen({})} aria-label=${`Comments${openThreads.length ? ` (${openThreads.length} open)` : ''}`}>
            <span class="hide-sm">Comments</span>${openThreads.length > 0 && html` <span class="count count-neutral pg-count">${openThreads.length}</span>`}<//>
          <${Btn} size="sm" kind="ghost" icon="history" onClick=${() => setHistoryOpen(true)} aria-label="History"><span class="hide-sm">History</span><//>
          ${canPush && html`<${Btn} size="sm" kind="secondary" icon="edit" onClick=${() => setEditing({ text: doc.text, sha: doc.sha, missing: doc.missing })}>Edit<//>`}
        </div>
      </header>
      ${doc.missing ? html`<${EmptyState} icon="file-text" title="This page has no content yet">
          ${canPush ? html`Click <b>Edit</b> to write it. It's saved to <code>${path}</code>.` : html`Someone with edit access can write it.`}<//>`
        : html`<${MarkdownView} body=${body} pagePath=${path} base=${base} onHeadings=${setHeadings} class="page-body"
            threadAnchors=${anchorCounts} onThreadBadge=${(a) => setCommentsOpen({ anchor: a })} />`}
    </article>
    ${showToc && html`<aside class="toc-rail pg-toc-rail"><${Toc} headings=${headings} base=${base} active=${activeH} /></aside>`}
    ${historyOpen && html`<${PageHistoryDrawer} page=${meta} path=${path} current=${{ text: doc.text, sha: doc.sha }} canPush=${canPush}
      onClose=${() => setHistoryOpen(false)} onRestored=${() => { setHistoryOpen(false); load(); }} />`}
    ${commentsOpen && html`<${Drawer} title=${`Comments · ${meta.title}`} onClose=${() => setCommentsOpen(null)} width=${460} class="pg-comments-drawer">
      <${Comments} targetType="page" targetId=${id} anchors=${anchors} focusAnchor=${commentsOpen.anchor}
        onAnchor=${(a) => { setCommentsOpen(null); setTimeout(() => scrollToHeading(a), 50); }} />
    <//>`}
  </div>`;
}
