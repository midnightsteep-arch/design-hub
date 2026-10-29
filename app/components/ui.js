// Basic UI building blocks.
import { html, cx, initials, isBotActor, shortActor, relTime, fullTime } from '../lib.js';
import { Icon } from '../icons.js';
import { useEffect, useRef, useState, useLayoutEffect } from '../../vendor/hooks.module.js';

export function Btn({ kind = 'secondary', size, icon, iconRight, children, class: cls, loading, ...rest }) {
  return html`<button type="button" class=${cx('btn', 'btn-' + kind, size && 'btn-' + size, loading && 'is-loading', cls)} ...${rest}>
    ${loading ? html`<span class="spinner spinner-sm" aria-hidden="true"></span>` : icon && html`<${Icon} name=${icon} size=${size === 'lg' ? 18 : 16} />`}
    ${children != null && children !== false && html`<span class="btn-label">${children}</span>`}
    ${iconRight && html`<${Icon} name=${iconRight} size=${14} class="btn-icon-right" />`}
  </button>`;
}

export function LinkBtn({ kind = 'secondary', size, icon, children, class: cls, ...rest }) {
  return html`<a class=${cx('btn', 'btn-' + kind, size && 'btn-' + size, cls)} ...${rest}>
    ${icon && html`<${Icon} name=${icon} size=${16} />`}
    ${children != null && html`<span class="btn-label">${children}</span>`}
  </a>`;
}

export function IconBtn({ icon, label, size = 16, class: cls, active, small, ...rest }) {
  return html`<button type="button" class=${cx('icon-btn', small && 'icon-btn-sm', active && 'is-active', cls)} aria-label=${label} title=${rest.title || label} aria-pressed=${active != null ? String(!!active) : undefined} ...${rest}>
    <${Icon} name=${icon} size=${size} />
  </button>`;
}

export function Kbd({ children }) { return html`<kbd class="kbd">${children}</kbd>`; }

export function Spinner({ size = 'md', label = 'Loading' }) {
  return html`<span class=${'spinner spinner-' + size} role="status" aria-label=${label}></span>`;
}

export function Skeleton({ w, h = 12, r, class: cls, style }) {
  return html`<span class=${cx('skel', cls)} style=${{ width: typeof w === 'number' ? w + 'px' : w, height: typeof h === 'number' ? h + 'px' : h, borderRadius: r, ...(style || {}) }} aria-hidden="true"></span>`;
}

export function SkeletonLines({ lines = 4 }) {
  const widths = ['92%', '78%', '85%', '64%', '88%', '71%', '55%'];
  return html`<div class="skel-lines" aria-busy="true" aria-label="Loading">
    ${Array.from({ length: lines }, (_, i) => html`<${Skeleton} w=${widths[i % widths.length]} h=${12} />`)}
  </div>`;
}

export function EmptyState({ icon = 'inbox', title, children, action, compact }) {
  return html`<div class=${cx('empty', compact && 'empty-compact')}>
    <div class="empty-icon"><${Icon} name=${icon} size=${20} /></div>
    <div class="empty-title">${title}</div>
    ${children && html`<div class="empty-text">${children}</div>`}
    ${action && html`<div class="empty-action">${action}</div>`}
  </div>`;
}

export function ErrorPanel({ error, onRetry, title, compact }) {
  const status = error && error.status;
  let t = title || 'Something went wrong';
  let msg = (error && error.message) || String(error || '');
  if (status === 404) t = title || 'Not found';
  if (status === 0) t = 'Offline';
  return html`<div class=${cx('error-panel', compact && 'error-compact')} role="alert">
    <div class="error-icon"><${Icon} name="alert" size=${18} /></div>
    <div class="error-main">
      <div class="error-title">${t}</div>
      <div class="error-text">${msg}</div>
    </div>
    ${onRetry && html`<${Btn} size="sm" icon="refresh" onClick=${onRetry}>Retry<//>`}
  </div>`;
}

export function Avatar({ actor, size = 22 }) {
  const bot = isBotActor(actor);
  const name = shortActor(actor);
  // stable hue from the name
  let hsh = 0;
  for (const ch of String(actor || '')) hsh = (hsh * 31 + ch.charCodeAt(0)) >>> 0;
  const hue = hsh % 360;
  return html`<span class=${cx('avatar', bot && 'avatar-bot')} style=${{ width: size + 'px', height: size + 'px', '--av-h': hue, fontSize: Math.round(size * 0.42) + 'px' }} title=${bot ? 'Claude (bot)' : actor} aria-hidden="true">
    ${bot ? html`<${Icon} name="bot" size=${Math.round(size * 0.62)} />` : initials(name)}
  </span>`;
}

export function Who({ actor, at, prefix }) {
  return html`<span class="who">
    ${prefix && html`<span class="muted">${prefix} </span>`}
    <span class="who-name">${shortActor(actor)}</span>
    ${at ? html`<span class="muted"> · </span><time class="muted" datetime=${new Date(at).toISOString()} title=${fullTime(at)}>${relTime(at)}</time>` : null}
  </span>`;
}

export function RelTime({ at }) {
  if (!at) return html`<span class="muted">—</span>`;
  return html`<time datetime=${new Date(at).toISOString()} title=${fullTime(at)}>${relTime(at)}</time>`;
}

export function Badge({ children, tone = 'neutral', class: cls, title }) {
  return html`<span class=${cx('badge', 'badge-' + tone, cls)} title=${title}>${children}</span>`;
}

export function Count({ n, tone = 'neutral', label }) {
  if (!n) return null;
  return html`<span class=${'count count-' + tone} aria-label=${label ? `${n} ${label}` : undefined}>${n > 999 ? Math.round(n / 100) / 10 + 'k' : n}</span>`;
}

// ARIA tablist (for in-page tab widgets)
let tabsSeq = 0;
export function Tabs({ tabs, value, onChange, label, class: cls, size, idPrefix }) {
  const ref = useRef(null);
  const prefix = useRef(idPrefix || 'tabs' + (++tabsSeq)).current;
  const onKey = (e) => {
    const i = tabs.findIndex((t) => t.id === value);
    let ni = null;
    if (e.key === 'ArrowRight') ni = (i + 1) % tabs.length;
    else if (e.key === 'ArrowLeft') ni = (i - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home') ni = 0;
    else if (e.key === 'End') ni = tabs.length - 1;
    if (ni != null) {
      e.preventDefault();
      onChange(tabs[ni].id);
      requestAnimationFrame(() => ref.current && ref.current.querySelector(`[data-tab="${CSS.escape(tabs[ni].id)}"]`)?.focus());
    }
  };
  return html`<div class=${cx('seg-tabs', size && 'seg-tabs-' + size, cls)} role="tablist" aria-label=${label} ref=${ref} onKeyDown=${onKey}>
    ${tabs.map((t) => html`<button type="button" role="tab" key=${t.id} data-tab=${t.id} id=${prefix + '-' + t.id}
      aria-selected=${String(t.id === value)} tabindex=${t.id === value ? 0 : -1}
      class=${cx('seg-tab', t.id === value && 'is-active')} onClick=${() => onChange(t.id)}>
      ${t.icon && html`<${Icon} name=${t.icon} size=${14} />`}<span>${t.label}</span>${t.count != null && t.count !== 0 && html`<span class="seg-count">${t.count}</span>`}
    </button>`)}
  </div>`;
}

export function Segmented({ options, value, onChange, label, size }) {
  return html`<div class=${cx('segmented', size && 'segmented-' + size)} role="radiogroup" aria-label=${label}>
    ${options.map((o) => html`<button type="button" role="radio" aria-checked=${String(o.value === value)} key=${o.value}
      class=${cx('seg-opt', o.value === value && 'is-active')} onClick=${() => onChange(o.value)} title=${o.title || o.label}>
      ${o.icon && html`<${Icon} name=${o.icon} size=${14} />`}${o.label && html`<span>${o.label}</span>`}
    </button>`)}
  </div>`;
}

// Auto-growing textarea
export function AutoTextarea({ value, minRows = 2, maxRows = 14, class: cls, inputRef, ...rest }) {
  const ref = useRef(null);
  const setRef = (el) => { ref.current = el; if (inputRef) inputRef.current = el; };
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    const lh = parseFloat(getComputedStyle(el).lineHeight) || 20;
    const pad = el.offsetHeight - el.clientHeight + parseFloat(getComputedStyle(el).paddingTop) + parseFloat(getComputedStyle(el).paddingBottom);
    const max = lh * maxRows + pad;
    const min = lh * minRows + pad;
    el.style.height = Math.max(min, Math.min(max, el.scrollHeight + (el.offsetHeight - el.clientHeight))) + 'px';
  }, [value]);
  return html`<textarea ref=${setRef} class=${cx('input', 'textarea', cls)} value=${value} ...${rest}></textarea>`;
}

export function useDebounced(value, ms) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function useMediaQuery(q) {
  const get = () => (window.matchMedia ? window.matchMedia(q).matches : false);
  const [m, setM] = useState(get);
  useEffect(() => {
    if (!window.matchMedia) return undefined;
    const mq = window.matchMedia(q);
    const f = () => setM(mq.matches);
    mq.addEventListener ? mq.addEventListener('change', f) : mq.addListener(f);
    f();
    return () => (mq.removeEventListener ? mq.removeEventListener('change', f) : mq.removeListener(f));
  }, [q]);
  return m;
}

export function useOnScreen(ref, rootMargin = '600px') {
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    if (seen || !ref.current) return undefined;
    if (!('IntersectionObserver' in window)) { setSeen(true); return undefined; }
    const io = new IntersectionObserver((ents) => {
      if (ents.some((x) => x.isIntersecting)) { setSeen(true); io.disconnect(); }
    }, { rootMargin });
    io.observe(ref.current);
    return () => io.disconnect();
  }, [seen]);
  return seen;
}

// One shared ResizeObserver for every measured element (rows can have hundreds). No synchronous
// layout reads: the first width arrives with the observer's initial callback.
const roCallbacks = new WeakMap();
let sharedRO = null;
// Deliver sizes on the next frame (or after 100 ms in a background tab) rather than inside the
// observer callback, so the re-render it causes can't trigger "ResizeObserver loop" errors.
const roPending = new Map();
let roFlushScheduled = false;
function roFlush() {
  roFlushScheduled = false;
  const batch = Array.from(roPending);
  roPending.clear();
  for (const [el, rect] of batch) {
    const cb = roCallbacks.get(el);
    if (cb) cb(rect);
  }
}
function getRO() {
  if (!sharedRO && 'ResizeObserver' in window) {
    sharedRO = new ResizeObserver((ents) => {
      for (const e of ents) roPending.set(e.target, e.contentRect);
      if (roFlushScheduled) return;
      roFlushScheduled = true;
      let done = false;
      const run = () => { if (!done) { done = true; roFlush(); } };
      requestAnimationFrame(run);
      setTimeout(run, 100);
    });
  }
  return sharedRO;
}
export function observeSize(el, cb) {
  const ro = getRO();
  if (!ro || !el) { if (el) cb(el.getBoundingClientRect()); return () => {}; }
  roCallbacks.set(el, cb);
  ro.observe(el);
  return () => { roCallbacks.delete(el); ro.unobserve(el); };
}

export function useElementWidth(ref, key) {
  const [w, setW] = useState(0);
  useEffect(() => {
    if (!ref.current) return undefined;
    return observeSize(ref.current, (r) => {
      const cw = Math.round(r.width);
      setW((old) => (Math.abs(old - cw) >= 1 ? cw : old));
    });
  }, [key]);
  return w;
}

export function PageHeader({ title, sub, actions, icon, eyebrow }) {
  return html`<header class="page-head">
    <div class="page-head-main">
      ${eyebrow && html`<div class="eyebrow">${eyebrow}</div>`}
      <h1 class="page-title">${icon && html`<${Icon} name=${icon} size=${20} class="page-title-icon" />`}${title}</h1>
      ${sub && html`<div class="page-sub">${sub}</div>`}
    </div>
    ${actions && html`<div class="page-head-actions">${actions}</div>`}
  </header>`;
}
