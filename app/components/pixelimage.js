// Pixel-perfect image display: integer-scale fitting on a selectable background.
import { html, cx, storage } from '../lib.js';
import { useEffect, useState, useMemo } from '../../vendor/hooks.module.js';
import { fitScale, knownDims, rememberDims, sizeAt, devMultiple } from '../pixel.js';
import { createStore, useStore, useDpr } from '../store.js';
import { repoStore } from '../repo.js';
import { Icon } from '../icons.js';

// ---------------------------------------------------------------- shared background preference
export const bgStore = createStore({ bg: storage.get('hub.bg', 'checker') });

export function bgOptions(project) {
  const opts = [
    { id: 'checker', label: 'Checkerboard' },
    { id: 'dark', label: 'Dark' },
    { id: 'light', label: 'Light' },
    { id: 'meta', label: 'Asset background' },
  ];
  const custom = (project && project.settings && Array.isArray(project.settings.backgrounds)) ? project.settings.backgrounds : [];
  custom.forEach((b, i) => {
    if (b && typeof b.color === 'string') opts.push({ id: 'p' + i, label: b.label || b.color, color: b.color });
  });
  return opts;
}
export function useBg() { return useStore(bgStore, (s) => s.bg); }
export function setBg(id) { storage.set('hub.bg', id); bgStore.set({ bg: id }); }
export function cycleBg(project) {
  const opts = bgOptions(project);
  const i = opts.findIndex((o) => o.id === bgStore.get().bg);
  setBg(opts[(i + 1) % opts.length].id);
  return opts[(i + 1) % opts.length];
}
export function bgLabel(project, id) {
  const o = bgOptions(project).find((x) => x.id === id);
  return o ? o.label : 'Checkerboard';
}

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
// Returns {class, style} for a stage/thumbnail background.
export function bgProps(bg, meta, project) {
  if (bg === 'dark') return { cls: 'bg-dark', style: null };
  if (bg === 'light') return { cls: 'bg-light', style: null };
  if (bg === 'meta') {
    const c = meta && meta.bg;
    if (typeof c === 'string' && HEX.test(c)) return { cls: 'bg-solid', style: { background: c } };
    return { cls: 'bg-checker', style: null };
  }
  if (bg && bg[0] === 'p') {
    const o = bgOptions(project).find((x) => x.id === bg);
    if (o && o.color) return { cls: 'bg-solid', style: { background: o.color } };
  }
  return { cls: 'bg-checker', style: null };
}

export function BgToggle({ project, small }) {
  const bg = useBg();
  const label = bgLabel(project, bg);
  return html`<button type="button" class=${cx('icon-btn', small && 'icon-btn-sm', 'bg-toggle')} onClick=${() => cycleBg(project)}
    title=${`Background: ${label} (B to cycle)`} aria-label=${`Preview background: ${label}. Click to cycle`}>
    <span class=${cx('bg-swatch', bgProps(bg, null, project).cls)} style=${bgProps(bg, null, project).style}></span>
  </button>`;
}

// ---------------------------------------------------------------- PixelImage
// Fixed box (boxW × boxH CSS px). The image is drawn at the largest integer scale that fits; if even 1×
// does not fit it is downscaled crisply and labelled "↓ NN%".
export function PixelImage({ src, alt = '', boxW, boxH, hintW, hintH, bg, meta, project, showScale = true, class: cls, lazy = true, onDims, title, pixelated = true }) {
  const dpr = useDpr();
  const globalBg = useBg();
  const proj = project || ((repoStore.get().hub || {}).project);
  const [dims, setDims] = useState(() => knownDims(src) || (hintW && hintH ? { w: hintW, h: hintH, guess: true } : null));
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
    setDims(knownDims(src) || (hintW && hintH ? { w: hintW, h: hintH, guess: true } : null));
  }, [src]);
  const onLoad = (e) => {
    const w = e.currentTarget.naturalWidth, h = e.currentTarget.naturalHeight;
    rememberDims(src, w, h);
    if (!dims || dims.w !== w || dims.h !== h || dims.guess) setDims({ w, h });
    if (onDims) onDims({ w, h });
  };
  const fit = dims ? fitScale(dims.w, dims.h, boxW, boxH, dpr) : null;
  const b = bgProps(bg || globalBg, meta, proj);
  const imgStyle = fit ? { width: fit.w + 'px', height: fit.h + 'px' } : { maxWidth: boxW + 'px', maxHeight: boxH + 'px', opacity: 0 };
  return html`<div class=${cx('pximg', b.cls, cls)} style=${{ width: boxW + 'px', height: boxH + 'px', ...(b.style || {}) }} title=${title}>
    ${src && !failed ? html`<img src=${src} alt=${alt} loading=${lazy ? 'lazy' : 'eager'} decoding="async" draggable="false"
      class=${cx(pixelated && (fit && fit.down ? 'px-down' : 'px-up'))} style=${imgStyle}
      onLoad=${onLoad} onError=${() => setFailed(true)} />`
      : html`<span class="pximg-missing" title=${failed ? 'Image failed to load' : 'No image'}><${Icon} name=${failed ? 'alert' : 'image'} size=${16} /></span>`}
    ${showScale && fit && !failed && html`<span class=${cx('scale-chip', fit.down && 'is-down')} title=${fit.down ? `Too large for this box even at 1×: shrunk to ${fit.pct}%` : `Shown at ${fit.k}× — every art pixel is ${devMultiple(fit.k, dpr)}×${devMultiple(fit.k, dpr)} screen pixels`}>${fit.down ? `↓${fit.pct}%` : `${fit.k}×`}</span>`}
  </div>`;
}

// Image at an explicit integer zoom (for stages). Returns natural dims via onDims.
export function ZoomedImage({ src, alt = '', k, class: cls, style, onDims, pixelated = true }) {
  const dpr = useDpr();
  const [dims, setDims] = useState(() => knownDims(src));
  useEffect(() => { setDims(knownDims(src)); }, [src]);
  useEffect(() => { if (dims && onDims) onDims(dims); }, [dims && dims.w, dims && dims.h, src]);
  const onLoad = (e) => {
    const w = e.currentTarget.naturalWidth, h = e.currentTarget.naturalHeight;
    rememberDims(src, w, h);
    if (!dims || dims.w !== w || dims.h !== h) setDims({ w, h });
  };
  const sz = dims ? sizeAt(dims.w, dims.h, k, dpr) : null;
  return html`<img src=${src} alt=${alt} draggable="false" decoding="async" class=${cx(pixelated && 'px-up', cls)}
    style=${{ ...(sz ? { width: sz.w + 'px', height: sz.h + 'px' } : { visibility: 'hidden' }), ...(style || {}) }} onLoad=${onLoad} />`;
}

// Largest integer zoom that fits a box for given dims (used by stages to pick their "fit" zoom).
export function useFitZoom(dims, boxW, boxH, max = 8) {
  const dpr = useDpr();
  return useMemo(() => {
    if (!dims || !boxW || !boxH) return 1;
    const f = fitScale(dims.w, dims.h, boxW, boxH, dpr, max);
    return f && !f.down ? Math.min(max, f.k) : 1;
  }, [dims && dims.w, dims && dims.h, boxW, boxH, dpr, max]);
}
