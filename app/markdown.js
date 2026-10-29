// Page markdown (contract §3): marked + DOMPurify, {{directives}} as island placeholders, GitHub alerts,
// in-app links (page:/asset:/table:/view:/tuning:), private-repo images (data-hub-src → blob URL),
// heading ids for the TOC, lazy mermaid. `safe` mode (discussion bodies) renders no directives.
import { Marked, Renderer } from '../vendor/marked.esm.js';
import DOMPurify from '../vendor/purify.es.mjs';
import { slugify } from './lib.js';
import { repoStore, fileExists, schemaTable } from './repo.js';
import { href } from './router.js';

export const DIRECTIVES = new Set(['tuning', 'view', 'table', 'chart', 'stats', 'assets', 'toc']);
const ALERTS = { note: 'Note', tip: 'Tip', important: 'Important', warning: 'Warning', caution: 'Caution' };
const ALERT_ICONS = {
  note: '<circle cx="12" cy="12" r="9.5"/><path d="M12 16v-4M12 8h.01"/>',
  tip: '<path d="M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z"/>',
  important: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M12 7v4M12 14h.01"/>',
  warning: '<path d="m10.3 3.9-8.2 14A2 2 0 0 0 3.8 21h16.4a2 2 0 0 0 1.7-3.1l-8.2-14a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
  caution: '<path d="M7.86 2h8.28L22 7.86v8.28L16.14 22H7.86L2 16.14V7.86z"/><path d="M12 8v4M12 16h.01"/>',
};
const WARN_ICON = '<svg class="icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m10.3 3.9-8.2 14A2 2 0 0 0 3.8 21h16.4a2 2 0 0 0 1.7-3.1l-8.2-14a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/></svg>';
const IMG_ICON = '<svg class="icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/></svg>';

export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const stripTags = (s) => String(s).replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
const warn = (inner, title) => `<span class="directive-warn"${title ? ` title="${esc(title)}"` : ''}>${WARN_ICON} ${inner}</span>`;

let ctx = null; // set per render: {pagePath, base, safe, headings, ids, hasMermaid}

// ---------------------------------------------------------------- repo path helpers
function normPath(p) {
  const out = [];
  for (const seg of String(p).split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') { if (!out.length) return null; out.pop(); } else out.push(seg);
  }
  return out.join('/');
}
function decodeSafe(s) { try { return decodeURIComponent(s); } catch (e) { return s; } }
/** Resolve an image reference in a page to a repo path: page-relative first, then design-relative (§3). */
export function resolveImage(src, pagePath) {
  const s = decodeSafe(String(src || '').trim().split(/[?#]/)[0]);
  if (!s) return { path: null, tried: [] };
  const designRoot = repoStore.get().designRoot || 'design';
  const cands = [];
  if (s.startsWith('/')) cands.push(normPath(s), normPath(designRoot + s));
  else {
    if (pagePath) cands.push(normPath(pagePath.replace(/[^/]*$/, '') + s));
    cands.push(normPath(designRoot + '/' + s), normPath(s));
  }
  const tried = [...new Set(cands.filter(Boolean))];
  return { path: tried.find((p) => fileExists(p)) || null, tried };
}

// ---------------------------------------------------------------- in-app links
function inAppTarget(kind, id) {
  const s = repoStore.get();
  switch (kind) {
    case 'page': return s.pages.some((p) => p.id === id) ? { to: href.page(id) } : null;
    case 'asset': { const a = s.assets.find((x) => x.id === id); return a ? { to: href.asset(id, a.group) } : null; }
    case 'tuning': return schemaTable(id) ? { to: href.tuning(id) } : null;
    case 'view': case 'table':
      if (s.views[id]) return { to: '#', view: id };
      if (kind === 'table' && schemaTable(id)) return { to: href.tuning(id) }; // Design Tracker "table:" may mean a tuning table here
      return null;
    default: return null;
  }
}
const KIND_WORD = { page: 'page', asset: 'asset', tuning: 'tuning table', view: 'data table', table: 'table' };

const md = new Marked({ gfm: true, breaks: false });

md.use({
  extensions: [{
    name: 'directive',
    level: 'block',
    start(src) {
      const m = /(^|\n)[ \t]*\{\{/.exec(src);
      return m ? m.index + m[1].length : undefined;
    },
    tokenizer(src) {
      const m = /^[ \t]*\{\{\s*([a-zA-Z][\w-]*)\s*(?::\s*([^}\n]*?))?\s*\}\}[ \t]*(?:\n+|$)/.exec(src);
      if (m) return { type: 'directive', raw: m[0], name: m[1].toLowerCase(), arg: (m[2] || '').trim() };
      return undefined;
    },
    renderer(tok) {
      const text = `{{${esc(tok.name)}${tok.arg ? ':' + esc(tok.arg) : ''}}}`;
      if (ctx && ctx.safe) return `<p><code>${text}</code></p>\n`;
      if (!DIRECTIVES.has(tok.name)) return `<p>${warn(`Unknown directive <code>${text}</code>`, 'Directives: tuning, view, chart, stats, assets, toc')}</p>\n`;
      if (tok.name !== 'toc' && !tok.arg) return `<p>${warn(`<code>${text}</code> needs an id, e.g. <code>{{${esc(tok.name)}:ID}}</code>`)}</p>\n`;
      const name = tok.name === 'table' ? 'view' : tok.name;
      return `<div class="md-island md-island-${name}" data-directive="${name}" data-arg="${esc(tok.arg)}"></div>\n`;
    },
  }],
  renderer: {
    heading({ tokens, depth }) {
      const inner = this.parser.parseInline(tokens);
      const text = stripTags(inner).trim();
      if (ctx && ctx.safe) return `<h${depth}>${inner}</h${depth}>\n`;
      let id = slugify(text);
      let n = 2;
      const base = id;
      while (ctx && ctx.ids.has(id)) id = `${base}-${n++}`;
      if (ctx) { ctx.ids.add(id); ctx.headings.push({ depth, text, id }); }
      const link = ctx && ctx.base ? ctx.base + (ctx.base.includes('?') ? '&' : '?') + 'h=' + encodeURIComponent(id) : '#';
      return `<h${depth} id="h-${id}" data-heading="${id}">${inner}<a class="h-anchor" href="${esc(link)}" data-anchor="${id}" aria-label="Link to this section">#</a></h${depth}>\n`;
    },
    blockquote({ tokens }) {
      let body = this.parser.parse(tokens);
      const m = /^\s*<p>\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*(?:<br\s*\/?>)?\s*/i.exec(body);
      if (m) {
        const kind = m[1].toLowerCase();
        body = '<p>' + body.slice(m[0].length);
        body = body.replace(/^<p>\s*<\/p>\s*/, '');
        return `<div class="callout callout-${kind}" role="note"><div class="callout-title"><svg class="icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ALERT_ICONS[kind]}</svg>${ALERTS[kind]}</div><div class="callout-body">${body}</div></div>\n`;
      }
      return `<blockquote>\n${body}</blockquote>\n`;
    },
    link(tok) {
      const h = tok.href || '';
      const m = /^(page|asset|table|view|tuning):(.+)$/.exec(h);
      if (!m) return false; // default renderer
      const inner = this.parser.parseInline(tok.tokens);
      const id = decodeSafe(m[2]);
      const t = inAppTarget(m[1], id);
      if (!t) return warn(`${inner} <code>${esc(m[1])}:${esc(id)}</code>`, `Unknown ${KIND_WORD[m[1]]}`);
      const title = tok.title ? ` title="${esc(tok.title)}"` : '';
      if (t.view) return `<a href="#" class="inapp-link inapp-view" data-view-link="${esc(t.view)}"${title}>${inner}</a>`;
      return `<a href="${esc(t.to)}" class="inapp-link inapp-${m[1]}"${title}>${inner}</a>`;
    },
    image(tok) {
      const src = String(tok.href || '');
      const alt = tok.text || '';
      if (/^https?:\/\//i.test(src) || /^\/\//.test(src)) {
        // The app's CSP doesn't load outside images (and private repos have no public URLs): link instead.
        return `<a class="pg-ext-img" href="${esc(src.startsWith('//') ? 'https:' + src : src)}" target="_blank" rel="noopener noreferrer" title="${esc(src)}">${IMG_ICON}<span>External image${alt ? ': ' + esc(alt) : ''}</span></a>`;
      }
      if (/^data:image\/(png|jpe?g|gif|webp);/i.test(src)) return `<img class="pg-img" src="${esc(src)}" alt="${esc(alt)}">`;
      if (ctx && ctx.safe) return `<span class="pg-ext-img">${IMG_ICON}<span>Image${alt ? ': ' + esc(alt) : ''}</span></span>`;
      const r = resolveImage(src, ctx && ctx.pagePath);
      if (!r.path) return warn(`Missing image <code>${esc(src)}</code>`, r.tried.length ? 'Looked for ' + r.tried.join(', ') : '');
      return `<img class="pg-img" data-hub-src="${esc(r.path)}" alt="${esc(alt)}"${tok.title ? ` title="${esc(tok.title)}"` : ''} loading="lazy">`;
    },
    codespan({ text }) {
      // `#AD7757` in a page gets a colour swatch (palette tables are common in art docs).
      const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(text).trim());
      if (!m) return false;
      return `<code class="hex-code"><span class="swatch" data-swatch="#${m[1]}" aria-hidden="true"></span>${text}</code>`;
    },
    code(tok) {
      if (!(ctx && ctx.safe) && (tok.lang || '').trim().toLowerCase() === 'mermaid') {
        if (ctx) ctx.hasMermaid = true;
        return `<div class="mermaid-block"><pre class="mermaid-src">${esc(tok.text)}</pre></div>\n`;
      }
      return false;
    },
    table(tok) {
      return `<div class="md-table-wrap">${Renderer.prototype.table.call(this, tok)}</div>\n`;
    },
  },
});

DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    const h = node.getAttribute('href') || '';
    if (/^https?:\/\//i.test(h)) {
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noopener noreferrer');
    }
  }
  if (node.tagName === 'IMG') {
    // only data images we produced ourselves (blob URLs are set later by MarkdownView); never let a stray src reach the network
    const s = node.getAttribute('src');
    if (s && !/^(data:image\/|blob:)/i.test(s)) node.removeAttribute('src');
  }
  if (node.tagName === 'INPUT' && node.getAttribute('type') === 'checkbox') node.setAttribute('disabled', '');
  const swatch = node.getAttribute && node.getAttribute('data-swatch');
  if (swatch && /^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(swatch)) node.style.background = swatch;
});

/**
 * Render markdown to sanitized HTML. Returns {html, headings, hasMermaid}.
 * opts: pagePath (repo path of the page file, for relative images), base (page link for heading anchors),
 *       safe (discussion text: no directives, no heading ids, no mermaid, no repo images).
 */
export function renderMarkdown(body, { pagePath, base, safe } = {}) {
  ctx = { pagePath, base, safe: !!safe, headings: [], ids: new Set(), hasMermaid: false };
  let raw;
  try {
    raw = md.parse(String(body || ''), { async: false });
  } catch (e) {
    raw = `<div class="error-panel error-compact"><div class="error-main"><div class="error-title">Couldn't render this text</div><div class="error-text">${esc(e.message || e)}</div></div></div>`;
  }
  const out = { headings: ctx.headings, hasMermaid: ctx.hasMermaid };
  ctx = null;
  out.html = DOMPurify.sanitize(raw, {
    ADD_ATTR: ['target', 'data-directive', 'data-arg', 'data-anchor', 'data-heading', 'data-swatch', 'data-hub-src', 'data-view-link', 'loading'],
    FORBID_TAGS: ['style', 'form', 'iframe', 'object', 'embed'],
    FORBID_ATTR: ['style', 'srcset'],
  });
  return out;
}

// ---------------------------------------------------------------- mermaid (lazy)
let mermaidP = null;
function loadMermaid() {
  if (!mermaidP) {
    mermaidP = new Promise((resolve, reject) => {
      if (window.mermaid) { resolve(window.mermaid); return; }
      const s = document.createElement('script');
      s.src = 'vendor/mermaid.min.js'; // relative: the app is served from /design-hub/ on GitHub Pages
      s.async = true;
      s.onload = () => (window.mermaid ? resolve(window.mermaid) : reject(new Error('mermaid failed to initialise')));
      s.onerror = () => { mermaidP = null; reject(new Error('Could not load the diagram renderer')); };
      document.head.appendChild(s);
    });
  }
  return mermaidP;
}
let mmSeq = 0;
export async function renderMermaid(root, theme) {
  const nodes = Array.from(root.querySelectorAll('pre.mermaid-src'));
  if (!nodes.length) return;
  for (const n of nodes) n.parentElement.classList.add('is-loading');
  let mermaid;
  try {
    mermaid = await loadMermaid();
  } catch (e) {
    for (const n of nodes) { n.parentElement.classList.remove('is-loading'); n.parentElement.insertAdjacentHTML('afterbegin', warn(esc(e.message))); }
    return;
  }
  const dark = theme === 'dark';
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: dark ? 'dark' : 'neutral',
    fontFamily: getComputedStyle(document.documentElement).getPropertyValue('--font-sans') || 'system-ui',
    themeVariables: { fontSize: '13px' },
    // SVG <text> labels (not HTML in foreignObject) survive our DOMPurify pass and inherit the font
    flowchart: { htmlLabels: false },
    htmlLabels: false,
  });
  for (const n of nodes) {
    if (!n.isConnected) continue;
    const src = n.textContent;
    const id = 'mmd-' + (++mmSeq);
    try {
      const { svg } = await mermaid.render(id, src);
      if (!n.isConnected) continue;
      const div = document.createElement('div');
      div.className = 'mermaid-diagram';
      div.innerHTML = DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true, html: true }, ADD_TAGS: ['foreignObject'] });
      // natural size (the block scrolls sideways on narrow screens instead of shrinking the text)
      const svgEl = div.querySelector('svg');
      const vb = svgEl && svgEl.viewBox && svgEl.viewBox.baseVal;
      if (vb && vb.width) {
        svgEl.style.maxWidth = 'none';
        svgEl.style.width = Math.ceil(vb.width) + 'px';
        svgEl.style.height = Math.ceil(vb.height) + 'px';
      }
      n.parentElement.classList.remove('is-loading');
      n.replaceWith(div);
    } catch (e) {
      n.parentElement.classList.remove('is-loading');
      n.parentElement.classList.add('is-error');
      n.insertAdjacentHTML('beforebegin', warn('Diagram error: ' + esc(String((e && e.message) || e).slice(0, 200))));
      const stray = document.getElementById('d' + id);
      if (stray) stray.remove();
    }
  }
}
