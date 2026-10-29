// Renders page markdown and mounts directive islands (tuning tables, views, charts, stats, asset groups,
// toc), private images (data-hub-src → blob URL), heading discussion badges and data-table link modals.
import { html, h, render, cx } from '../lib.js';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from '../../vendor/hooks.module.js';
import { renderMarkdown, renderMermaid } from '../markdown.js';
import { app, useStore, effectiveTheme } from '../store.js';
import { repoStore, blobUrl } from '../repo.js';
import { navigate } from '../router.js';
import { DataTable, ViewDirective, StatsDirective } from './datatable.js';
import { Chart, ChartDirective } from './chart.js';
import { Modal } from './overlay.js';
import { TuningEmbed } from '../tuning/embed.js';
import { AssetGroupEmbed } from '../views/assets.js';

export function scrollToHeading(id, smooth = true) {
  const el = document.getElementById('h-' + id);
  if (!el) return false;
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  el.scrollIntoView({ block: 'start', behavior: smooth && !reduce ? 'smooth' : 'auto' });
  el.classList.add('is-target');
  setTimeout(() => el.classList.remove('is-target'), 1600);
  return true;
}
const withH = (base, id) => base + (base.includes('?') ? '&' : '?') + 'h=' + encodeURIComponent(id);

export function Toc({ headings, base, active, title = 'On this page', minDepth = 2, maxDepth = 3 }) {
  const items = (headings || []).filter((x) => x.depth >= minDepth && x.depth <= maxDepth);
  if (!items.length) return null;
  return html`<nav class="toc" aria-label=${title}>
    <div class="toc-title">${title}</div>
    <ul>
      ${items.map((x) => html`<li key=${x.id} class=${cx('toc-d' + x.depth, active === x.id && 'is-active')}>
        <a href=${base ? withH(base, x.id) : '#'} onClick=${(e) => {
          e.preventDefault();
          scrollToHeading(x.id);
          if (base) navigate(withH(base, x.id), { replace: true, keepScroll: true });
        }} aria-current=${active === x.id ? 'location' : undefined}>${x.text}</a>
      </li>`)}
    </ul>
  </nav>`;
}

function Island({ name, arg, headings, base }) {
  switch (name) {
    case 'tuning': return html`<${TuningEmbed} tableId=${arg} />`;
    case 'view': return html`<${ViewDirective} id=${arg} />`;
    case 'chart': return html`<${ChartDirective} arg=${arg} />`;
    case 'stats': return html`<${StatsDirective} id=${arg} />`;
    case 'assets': return html`<${AssetGroupEmbed} groupId=${arg} />`;
    case 'toc': return html`<${Toc} headings=${headings} base=${base} title="Contents" minDepth=${2} maxDepth=${3} />`;
    default: return null;
  }
}

/** A data table (and its charts) opened from a `table:ID` / `view:ID` link. */
export function ViewModal({ id, onClose }) {
  const view = useStore(repoStore, (s) => s.views[id] || null);
  return html`<${Modal} title=${view ? view.title || id : id} onClose=${onClose} size="lg" class="pg-view-modal">
    ${view ? html`<${DataTable} view=${view} showHeader=${false} maxHeight=${420} />
      ${view.description && html`<p class="muted pg-view-modal-desc">${view.description}</p>`}
      ${(view.charts || []).map((c) => html`<${Chart} key=${c.id} table=${view} chart=${c} height=${220} />`)}`
      : html`<p class="muted">This data table no longer exists.</p>`}
  <//>`;
}

let refsMemo = { files: undefined, key: '' };
function refsKey(s) {
  if (refsMemo.files === s.files && refsMemo.pages === s.pages && refsMemo.assets === s.assets && refsMemo.views === s.views && refsMemo.schema === s.schema) return refsMemo.key;
  const key = [
    (s.pages || []).map((p) => p.id).join(','),
    (s.assets || []).map((a) => a.id + '@' + a.group).join(','),
    Object.keys(s.views || {}).join(','),
    s.schema ? (s.schema.tables || []).map((t) => t.id).join(',') : '',
    s.files ? s.files.size : 0,
  ].join('|');
  refsMemo = { files: s.files, pages: s.pages, assets: s.assets, views: s.views, schema: s.schema, key };
  return key;
}

/**
 * Rendered markdown. props:
 *   body, pagePath (repo path, for relative images), base (page link for heading anchors), onHeadings(headings),
 *   safe (discussion text: no directives), threadAnchors ({anchor: count}), onThreadBadge(anchor).
 */
export function MarkdownView({ body, pagePath, base, onHeadings, class: cls, safe, threadAnchors, onThreadBadge }) {
  // Links/images depend on what the repo holds (pages, assets, views, tables, files): re-render when that set
  // changes — not on every save, so a value edited in an embedded table doesn't remount the whole page.
  const refs = useStore(repoStore, refsKey);
  const theme = useStore(app, (s) => s.theme);
  const [viewModal, setViewModal] = useState(null);
  const res = useMemo(() => renderMarkdown(body, { pagePath, base, safe }), [body, pagePath, base, safe, refs]);
  const ref = useRef(null);
  useEffect(() => { if (onHeadings) onHeadings(res.headings); }, [res]);
  const themeKey = res.hasMermaid ? effectiveTheme() + theme : '';
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return undefined;
    root.innerHTML = res.html;
    const islands = Array.from(root.querySelectorAll('[data-directive]'));
    for (const el of islands) {
      render(h(Island, { name: el.getAttribute('data-directive'), arg: el.getAttribute('data-arg'), headings: res.headings, base }), el);
    }
    let alive = true;
    for (const img of root.querySelectorAll('img[data-hub-src]')) {
      img.classList.add('is-loading');
      blobUrl(img.getAttribute('data-hub-src')).then((u) => {
        if (!alive) return;
        img.classList.remove('is-loading');
        if (u) img.src = u; else img.classList.add('is-missing');
      }).catch(() => { img.classList.remove('is-loading'); img.classList.add('is-missing'); });
    }
    if (res.hasMermaid) renderMermaid(root, effectiveTheme());
    return () => { alive = false; for (const el of islands) render(null, el); };
  }, [res, themeKey]);

  // discussion badges next to headings that have open page threads
  const anchorsKey = threadAnchors ? Object.entries(threadAnchors).map(([k, v]) => k + ':' + v).sort().join('|') : '';
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root || !threadAnchors) return undefined;
    const made = [];
    for (const [anchor, n] of Object.entries(threadAnchors)) {
      if (!n) continue;
      const hEl = root.querySelector(`[data-heading="${CSS.escape(anchor)}"]`);
      if (!hEl) continue;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'pg-hbadge';
      b.setAttribute('data-thread-anchor', anchor);
      b.setAttribute('aria-label', `${n} open comment${n === 1 ? '' : 's'} on this section`);
      b.title = `${n} open comment${n === 1 ? '' : 's'} on this section`;
      b.innerHTML = '<svg class="icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
      const t = document.createElement('span');
      t.textContent = String(n);
      b.appendChild(t);
      const anchorEl = hEl.querySelector('.h-anchor');
      hEl.insertBefore(b, anchorEl || null);
      made.push(b);
    }
    return () => made.forEach((b) => b.remove());
  }, [res, anchorsKey]);

  const onClick = (e) => {
    const t = e.target;
    if (!t.closest) return;
    const badge = t.closest('[data-thread-anchor]');
    if (badge) { e.preventDefault(); if (onThreadBadge) onThreadBadge(badge.getAttribute('data-thread-anchor')); return; }
    const vl = t.closest('a[data-view-link]');
    if (vl) {
      e.preventDefault();
      const id = vl.getAttribute('data-view-link');
      // embedded on this page? scroll to it; otherwise open it in a dialog
      const island = ref.current && ref.current.querySelector(`[data-directive="view"][data-arg="${CSS.escape(id)}"]`);
      if (island) { island.scrollIntoView({ block: 'start', behavior: 'smooth' }); island.classList.add('is-target'); setTimeout(() => island.classList.remove('is-target'), 1600); }
      else setViewModal(id);
      return;
    }
    const a = t.closest('a[data-anchor]');
    if (a) {
      e.preventDefault();
      const id = a.getAttribute('data-anchor');
      scrollToHeading(id);
      if (base) navigate(withH(base, id), { replace: true, keepScroll: true });
    }
  };
  return html`<div class=${cx('md', safe && 'md-safe', cls)} ref=${ref} onClick=${onClick}></div>
    ${viewModal && html`<${ViewModal} id=${viewModal} onClose=${() => setViewModal(null)} />`}`;
}
