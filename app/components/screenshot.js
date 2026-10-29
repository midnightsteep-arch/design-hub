// In-game capture crops centred on the asset's rect, and the full capture with the rect highlighted.
// `asset` is a view asset (assets.js): asset.capture = {file: "captures/x.png", rect: {x,y,w,h}} (design/assets/-relative).
import { html, cx } from '../lib.js';
import { useEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { knownDims, rememberDims } from '../pixel.js';
import { useDpr } from '../store.js';
import { Portal } from './overlay.js';
import { Icon } from '../icons.js';
import { useElementWidth } from './ui.js';
import { useRepoImage, captureRepoPath, captureSidecar } from '../assets.js';

export function parseRect(r) {
  if (!r) return null;
  if (typeof r === 'string') { try { r = JSON.parse(r); } catch (e) { return null; } }
  if (typeof r !== 'object') return null;
  const x = Number(r.x), y = Number(r.y), w = Number(r.w), h = Number(r.h);
  if (![x, y, w, h].every((n) => isFinite(n)) || w <= 0 || h <= 0) return null;
  return { x, y, w, h };
}

function useNatural(src) {
  const [d, setD] = useState(() => knownDims(src));
  useEffect(() => {
    const k = knownDims(src);
    setD(k);
    if (k || !src) return undefined;
    let alive = true;
    const img = new Image();
    img.onload = () => { rememberDims(src, img.naturalWidth, img.naturalHeight); if (alive) setD({ w: img.naturalWidth, h: img.naturalHeight }); };
    img.src = src;
    return () => { alive = false; };
  }, [src]);
  return d;
}

/** Capture image + rect + caption for a view asset. */
export function useCapture(asset) {
  const cap = asset && asset.capture;
  const img = useRepoImage(cap ? captureRepoPath(cap) : null);
  const side = cap ? captureSidecar(cap) : null;
  return {
    has: !!cap, src: img.src, loading: img.loading, error: img.error, rect: cap ? parseRect(cap.rect) : null,
    caption: (side && side.label) || (cap ? String(cap.file).split('/').pop() : ''), sidecar: side,
  };
}

/** Largest scale ≤ s that maps one image pixel to a whole number of device pixels. */
export function crispScale(s, dpr = 1) { const m = Math.floor(s * dpr + 1e-6); return m >= 1 ? m / dpr : s; }

export function cropRegion(W, H, rect, boxW, boxH, dpr, pad = 0.75) {
  const aspect = boxW / boxH;
  let rw = Math.max(rect.w * (1 + 2 * pad), 40);
  let rh = Math.max(rect.h * (1 + 2 * pad), 40);
  if (rw / rh > aspect) rh = rw / aspect; else rw = rh * aspect;
  let s = boxW / rw;
  let up = false;
  if (s * dpr >= 1) {
    // a whole number of device pixels per screenshot pixel, so pixel games stay crisp
    s = crispScale(s, dpr);
    up = s * dpr >= 2;
    rw = boxW / s; rh = boxH / s;
  }
  const cxp = rect.x + rect.w / 2, cyp = rect.y + rect.h / 2;
  let x0 = cxp - rw / 2, y0 = cyp - rh / 2;
  x0 = rw >= W ? (W - rw) / 2 : Math.max(0, Math.min(x0, W - rw));
  y0 = rh >= H ? (H - rh) / 2 : Math.max(0, Math.min(y0, H - rh));
  return { x0, y0, s, up };
}

export function ScreenshotCrop({ asset, boxW, boxH, onClick, hoverPreview = true, class: cls, label }) {
  const dpr = useDpr();
  const cap = useCapture(asset);
  const { src, rect } = cap;
  const nat = useNatural(src);
  const [hover, setHover] = useState(false);
  const ref = useRef(null);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  if (!cap.has || (!src && !cap.loading)) {
    return html`<div class=${cx('shot shot-empty', cls)} style=${{ width: boxW + 'px', height: boxH + 'px' }}>
      <span>${cap.has ? 'Screenshot missing' : 'No screenshot'}</span>
    </div>`;
  }
  let inner;
  if (src && nat) {
    const r = rect || { x: 0, y: 0, w: nat.w, h: nat.h };
    const reg = rect ? cropRegion(nat.w, nat.h, r, boxW, boxH, dpr) : (() => {
      const s = Math.min(boxW / nat.w, boxH / nat.h);
      return { x0: (nat.w - boxW / s) / 2, y0: (nat.h - boxH / s) / 2, s, up: false };
    })();
    inner = html`
      <img src=${src} alt="" decoding="async" draggable="false" class=${reg.up ? 'px-up' : 'px-smooth'}
        style=${{ left: (-reg.x0 * reg.s) + 'px', top: (-reg.y0 * reg.s) + 'px', width: (nat.w * reg.s) + 'px', height: (nat.h * reg.s) + 'px' }} />
      ${rect && html`<span class="shot-rect" data-rect=${`${rect.x},${rect.y},${rect.w},${rect.h}`} style=${{ left: ((r.x - reg.x0) * reg.s) + 'px', top: ((r.y - reg.y0) * reg.s) + 'px', width: (r.w * reg.s) + 'px', height: (r.h * reg.s) + 'px' }}></span>`}`;
  } else inner = html`<span class="skel as-shot-skel" aria-hidden="true"></span>`;
  const onEnter = () => {
    if (!hoverPreview || (window.matchMedia && window.matchMedia('(hover: none)').matches)) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setHover(true), 280);
  };
  const onLeave = () => { clearTimeout(timer.current); setHover(false); };
  const Tag = onClick ? 'button' : 'div';
  return html`<${Tag} type=${onClick ? 'button' : undefined} ref=${ref} class=${cx('shot', onClick && 'shot-btn', cls)}
      style=${{ width: boxW + 'px', height: boxH + 'px' }}
      onClick=${onClick} onMouseEnter=${onEnter} onMouseLeave=${onLeave} onFocus=${onEnter} onBlur=${onLeave}
      aria-label=${label || (cap.caption ? `In-game screenshot: ${cap.caption}` : 'In-game screenshot')}>
      ${inner}
      ${hover && src && html`<${ShotPreview} asset=${asset} anchor=${ref} caption=${cap.caption} />`}
    <//>`;
}

function ShotPreview({ asset, anchor, caption }) {
  const [pos, setPos] = useState(null);
  const W = Math.min(520, window.innerWidth - 24), H = Math.round(W * 0.6);
  useEffect(() => {
    const a = anchor.current;
    if (!a) return;
    const r = a.getBoundingClientRect();
    let left = r.right + 12;
    if (left + W > window.innerWidth - 8) left = r.left - W - 12;
    if (left < 8) left = Math.max(8, Math.min(r.left, window.innerWidth - W - 8));
    let top = r.top + r.height / 2 - H / 2;
    top = Math.max(8, Math.min(top, window.innerHeight - H - 40));
    setPos({ left, top });
  }, []);
  return html`<${Portal}>
    <div class="shot-preview" style=${{ left: (pos ? pos.left : -9999) + 'px', top: (pos ? pos.top : -9999) + 'px' }} aria-hidden="true">
      <${ScreenshotCrop} asset=${asset} boxW=${W} boxH=${H} hoverPreview=${false} />
      ${caption && html`<div class="shot-caption">${caption}</div>`}
    </div>
  <//>`;
}

// Full capture, fitted to the container width (integer upscale when it is small), rect highlighted, rest dimmed.
export function ScreenshotFull({ asset, maxH = 520 }) {
  const dpr = useDpr();
  const wrap = useRef(null);
  const cw = useElementWidth(wrap);
  const cap = useCapture(asset);
  const { src, rect } = cap;
  const nat = useNatural(src);
  const [dim, setDim] = useState(true);
  if (!cap.has) return null;
  let s = 1, up = false;
  if (nat && cw) {
    s = Math.min(cw / nat.w, maxH / nat.h);
    if (s * dpr >= 1) { s = crispScale(s, dpr); up = s * dpr >= 2; }
  }
  const w = nat ? nat.w * s : 0, h = nat ? nat.h * s : 0;
  return html`<figure class="shot-full">
    <div class="shot-full-wrap" ref=${wrap}>
      ${src && nat && cw ? html`<div class="shot-full-canvas" style=${{ width: w + 'px', height: h + 'px' }}>
        <img src=${src} alt=${cap.caption || 'In-game screenshot'} class=${up ? 'px-up' : 'px-smooth'} style=${{ width: w + 'px', height: h + 'px' }} draggable="false" />
        ${rect && html`<span class=${cx('shot-full-rect', dim && 'is-dim')} data-rect=${`${rect.x},${rect.y},${rect.w},${rect.h}`} style=${{ left: rect.x * s + 'px', top: rect.y * s + 'px', width: rect.w * s + 'px', height: rect.h * s + 'px' }}></span>`}
      </div>` : !cap.loading && !src ? html`<div class="as-shot-missing muted">The screenshot file is missing from the repo.</div>`
        : html`<div class="skel" style=${{ width: '100%', height: '220px', display: 'block' }}></div>`}
    </div>
    <figcaption class="shot-full-cap">
      <span class="muted">${cap.caption || 'In-game screenshot'}${nat ? ` · ${nat.w}×${nat.h}` : ''}${rect ? ` · box ${rect.w}×${rect.h} at ${rect.x},${rect.y}` : ''}</span>
      <span class="spacer"></span>
      ${rect && html`<button type="button" class="btn btn-ghost btn-xs" aria-pressed=${String(dim)} onClick=${() => setDim(!dim)}>${dim ? 'Undim' : 'Dim outside'}</button>`}
      ${src && html`<a class="btn btn-ghost btn-xs" href=${src} target="_blank" rel="noopener"><${Icon} name="external" size=${12} /><span class="btn-label">Full size</span></a>`}
    </figcaption>
  </figure>`;
}
