// Compare stage (current vs replacement / capture; side-by-side, swipe, onion) + shared detail parts
// (text stage, status buttons, metadata, translations, review history). Works on view assets (assets.js).
import { html, cx, STATUS, STATUSES, relTime, fullTime, shortActor, KIND_LABEL, modKey } from '../lib.js';
import { useEffect, useLayoutEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { Icon } from '../icons.js';
import { ZoomedImage, bgProps, useBg, BgToggle, useFitZoom } from './pixelimage.js';
import { knownDims, devMultiple } from '../pixel.js';
import { useDpr } from '../store.js';
import { useFileDrop, pickFile, acceptFor, useChecks, CheckChips, TextReplacementEditor, useReplacementSrc } from './replace.js';
import { attachFile, removeReplacement, changeStatus, assetDims, useRepoImage, useProject } from '../assets.js';
import { ScreenshotCrop } from './screenshot.js';
import { Segmented, observeSize, Avatar } from './ui.js';

export const ZOOMS = [1, 2, 3, 4, 5, 6, 7, 8];

function useSize(ref, key) {
  const [s, setS] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    if (!ref.current) return undefined;
    return observeSize(ref.current, (r) => {
      const w = Math.floor(r.width), h = Math.floor(r.height);
      setS((o) => (o.w === w && o.h === h ? o : { w, h }));
    });
  }, [key]);
  return s;
}

// In-game crop that fills its pane (measured), centred on the highlight rect.
function PaneShot({ asset }) {
  const ref = useRef(null);
  const sz = useSize(ref);
  return html`<div class="pane-shot-fit" ref=${ref}>
    ${sz.w > 40 && sz.h > 40 && html`<${ScreenshotCrop} asset=${asset} boxW=${sz.w} boxH=${sz.h} hoverPreview=${false} />`}
  </div>`;
}

// ---------------------------------------------------------------- frame player (meta.frames sheets)
function FramePlayer({ src, dims, frames, k, playing }) {
  const dpr = useDpr();
  const cols = Math.max(1, Number(frames.cols) || 1), rows = Math.max(1, Number(frames.rows) || 1);
  const fps = Math.max(1, Math.min(60, Number(frames.fps) || 8));
  const n = cols * rows;
  const [f, setF] = useState(0);
  useEffect(() => {
    if (!playing) return undefined;
    const t = setInterval(() => setF((x) => (x + 1) % n), 1000 / fps);
    return () => clearInterval(t);
  }, [playing, n, fps]);
  if (!dims) return null;
  const fw = dims.w / cols, fh = dims.h / rows;
  const m = devMultiple(k, dpr) / dpr;
  const cx0 = (f % cols) * fw, cy0 = Math.floor(f / cols) * fh;
  return html`<div class="frame-view" style=${{ width: fw * m + 'px', height: fh * m + 'px' }} aria-label=${`Frame ${f + 1} of ${n}`}>
    <img src=${src} alt="" class="px-up" draggable="false" style=${{ width: dims.w * m + 'px', height: dims.h * m + 'px', transform: `translate(${-cx0 * m}px, ${-cy0 * m}px)` }} />
  </div>`;
}

// ---------------------------------------------------------------- one image pane
function Pane({ label, sub, src, k, bg, meta, project, children, dropProps, over, empty, frames, chips, onDims, playing, stageRef, loading }) {
  const b = bgProps(bg, meta, project);
  const [dims, setDims] = useState(() => (src ? knownDims(src) : null));
  useEffect(() => { setDims(src ? knownDims(src) : null); }, [src]);
  const onD = (d) => { setDims(d); onDims && onDims(d); };
  return html`<div class=${cx('pane', over && 'is-over')} ...${dropProps || {}}>
    <div class="pane-label"><span class="pane-title">${label}</span>${sub && html`<span class="pane-sub">${sub}</span>`}</div>
    <div class=${cx('pane-stage', b.cls)} style=${b.style} ref=${stageRef}>
      <div class="pane-center">
        ${src ? (frames && playing ? html`<${FramePlayer} src=${src} dims=${dims} frames=${frames} k=${k} playing=${playing} />` : html`<${ZoomedImage} src=${src} k=${k} onDims=${onD} alt=${label} />`)
          : loading ? html`<span class="spinner" aria-label="Loading image"></span>` : empty}
      </div>
    </div>
    ${chips && html`<div class="pane-foot">${chips}</div>`}
    ${children}
  </div>`;
}

// ---------------------------------------------------------------- CompareStage
export function CompareStage({ asset, zoom, setZoom, mode, setMode, compact, uploadRef, readOnly }) {
  const project = useProject();
  const bg = useBg();
  const paneRef = useRef(null);
  const cur = useRepoImage(asset.path || null);
  const curSrc = cur.src;
  const replSrc = useReplacementSrc(asset);
  const both = !!(curSrc && replSrc);
  const effMode = both ? mode : 'side';
  const [curDims, setCurDims] = useState(() => (curSrc ? knownDims(curSrc) : null) || assetDims(asset));
  useEffect(() => { setCurDims((curSrc ? knownDims(curSrc) : null) || assetDims(asset)); }, [curSrc]);
  const [replDims, setReplDims] = useState(() => (replSrc ? knownDims(replSrc) : null));
  useEffect(() => { setReplDims(replSrc ? knownDims(replSrc) : null); }, [replSrc]);
  const [split, setSplit] = useState(50);
  const [opacity, setOpacity] = useState(50);
  const [playing, setPlaying] = useState(false);
  const frames = asset.meta && asset.meta.frames && (asset.meta.frames.cols > 1 || asset.meta.frames.rows > 1) ? asset.meta.frames : null;
  const checks = useChecks(asset, replSrc);
  const { over, props: dropProps } = useFileDrop((f) => attachFile(asset.id, f), { disabled: readOnly });
  const browse = async () => { const f = await pickFile(acceptFor(asset.kind)); if (f) attachFile(asset.id, f); };
  if (uploadRef) uploadRef.current = readOnly ? null : browse;

  // fit zoom: measured from the first pane's stage (works for side-by-side and stacked layouts)
  const paneSize = useSize(paneRef, effMode);
  const paneW = Math.max(40, paneSize.w - 24);
  const paneH = Math.max(40, paneSize.h - 24);
  const fitDims = curDims && replDims ? { w: Math.max(curDims.w, replDims.w), h: Math.max(curDims.h, replDims.h) } : (curDims || replDims);
  const fitK = useFitZoom(fitDims, paneW, paneH, 8);
  const k = zoom || fitK;
  const rep = asset.replacement;

  const empty = readOnly
    ? html`<span class="muted">No replacement attached</span>`
    : html`<button type="button" class="pane-drop" onClick=${browse}>
      <${Icon} name="upload" size=${22} />
      <span class="pane-drop-title">Drop a replacement PNG</span>
      <span class="pane-drop-sub">or click to browse · paste with ${modKey}+V · press U</span>
    </button>`;
  const curSub = `${curDims ? `${curDims.w}×${curDims.h}` : ''}${asset.meta && asset.meta.filter ? ` · ${asset.meta.filter}` : ''}`;
  const replSub = replSrc ? `${replDims ? `${replDims.w}×${replDims.h}` : ''}${rep && rep.by ? ' · ' + shortActor(rep.by) : ''}${rep && rep.at ? ' · ' + relTime(Date.parse(rep.at)) : ''}` : 'none attached';

  let body;
  if (effMode === 'side') {
    const showShotPane = !replSrc && !asset.uploading && asset.capture;
    body = html`<div class="stage-side">
      <${Pane} label="Current" sub=${curSub} src=${curSrc} loading=${cur.loading} k=${k} bg=${bg} meta=${asset.meta} project=${project}
        frames=${frames} playing=${playing} onDims=${setCurDims} stageRef=${paneRef}
        empty=${html`<span class="muted">${cur.error === 'missing' ? 'The game file is not in the repo' : 'No current image'}</span>`} />
      ${!showShotPane
        ? html`<${Pane} label="Replacement" sub=${replSub}
            src=${replSrc} k=${k} bg=${bg} meta=${asset.meta} project=${project} dropProps=${dropProps} over=${over} empty=${empty} onDims=${setReplDims}
            frames=${frames} playing=${playing}
            chips=${replSrc && checks && checks.length > 0 && html`<${CheckChips} checks=${checks} />`}>
            ${asset.uploading && html`<div class="pane-busy"><span class="spinner"></span> Saving…</div>`}
          <//>`
        : html`<div class=${cx('pane', over && 'is-over')} ...${dropProps}>
            <div class="pane-label"><span class="pane-title">In game</span><span class="pane-sub">${readOnly ? 'screenshot' : 'drop a PNG here to attach a replacement'}</span></div>
            <div class="pane-stage pane-shot">
              <${PaneShot} asset=${asset} />
              ${over && html`<div class="pane-drop-over"><${Icon} name="upload" size=${22} /><span>Drop to attach as the replacement</span></div>`}
            </div>
          </div>`}
    </div>`;
  } else {
    const isSwipe = effMode === 'swipe';
    const b = bgProps(bg, asset.meta, project);
    body = html`<div class="pane pane-overlay">
      <div class="pane-label"><span class="pane-title">${isSwipe ? 'Swipe' : 'Onion skin'}</span>
        <span class="pane-sub">${isSwipe ? 'left: current · right: replacement' : `replacement at ${opacity}% over current`}</span></div>
      <div class=${cx('pane-stage', b.cls)} style=${b.style} ref=${paneRef}>
        <div class="pane-center">
          <div class="overlay-stack">
            <${ZoomedImage} src=${curSrc} k=${k} />
            <div class="overlay-top" style=${isSwipe ? { clipPath: `inset(0 0 0 ${split}%)` } : { opacity: opacity / 100 }}>
              <${ZoomedImage} src=${replSrc} k=${k} />
            </div>
            ${isSwipe && html`<div class="swipe-line" style=${{ left: split + '%' }} aria-hidden="true"></div>`}
          </div>
        </div>
      </div>
      <label class="overlay-slider">
        <span class="label-sm">${isSwipe ? 'Split' : 'Opacity'}</span>
        <input type="range" min="0" max="100" value=${isSwipe ? split : opacity} aria-label=${isSwipe ? 'Swipe position' : 'Replacement opacity'}
          onInput=${(e) => (isSwipe ? setSplit : setOpacity)(Number(e.currentTarget.value))} />
        <span class="mono muted">${isSwipe ? split : opacity}%</span>
        <${CheckChips} checks=${checks} />
      </label>
    </div>`;
  }

  return html`<div class=${cx('stage', compact && 'stage-compact')}>
    <div class="stage-toolbar" role="toolbar" aria-label="Preview controls">
      <div class="zoom-group" role="group" aria-label="Zoom">
        <button type="button" class=${cx('zoom-btn', !zoom && 'is-active')} onClick=${() => setZoom(null)} title="Largest whole-number zoom that fits">Fit${!zoom ? ` ${fitK}×` : ''}</button>
        ${ZOOMS.map((z) => html`<button type="button" key=${z} class=${cx('zoom-btn', zoom === z && 'is-active')} aria-pressed=${String(zoom === z)} onClick=${() => setZoom(z)}>${z}×</button>`)}
      </div>
      <span class="spacer"></span>
      ${frames && html`<button type="button" class=${cx('btn btn-ghost btn-xs', playing && 'is-active')} aria-pressed=${String(playing)} onClick=${() => setPlaying(!playing)} title=${`${frames.cols}×${frames.rows} frames at ${frames.fps || 8} fps`}>
        <${Icon} name=${playing ? 'minus' : 'play'} size=${12} /><span>${playing ? 'Sheet' : 'Animate'}</span></button>`}
      ${both && html`<${Segmented} size="sm" label="Compare mode" value=${mode} onChange=${setMode} options=${[
        { value: 'side', icon: 'columns', title: 'Side by side' },
        { value: 'swipe', icon: 'compare', title: 'Swipe' },
        { value: 'onion', icon: 'onion', title: 'Onion skin' },
      ]} />`}
      <${BgToggle} project=${project} small />
      ${readOnly ? null : asset.hasReplacement ? html`<button type="button" class="btn btn-ghost btn-xs" onClick=${() => removeReplacement(asset.id)} title="Remove the replacement"><${Icon} name="x" size=${12} /><span>Remove replacement</span></button>
        <button type="button" class="btn btn-secondary btn-xs" onClick=${browse}><${Icon} name="upload" size=${12} /><span>Swap</span></button>`
        : html`<button type="button" class="btn btn-secondary btn-xs" onClick=${browse}><${Icon} name="upload" size=${12} /><span>Upload</span></button>`}
    </div>
    <div class="stage-body">${body}</div>
  </div>`;
}

// ---------------------------------------------------------------- text compare
export function TextStage({ asset, inputRef, readOnly }) {
  const m = asset.meta || {};
  const max = Number(m.maxChars) || 0;
  const len = asset.text != null ? [...asset.text].length : 0;
  const rep = asset.replacement;
  return html`<div class="text-stage">
    <div class="text-pane">
      <div class="pane-label"><span class="pane-title">Current text</span><span class="pane-sub">${m.key || ''}</span>
        <span class=${cx('charcount', max && len > max && 'is-over')}>${len}${max ? ` / ${max}` : ''} chars</span></div>
      <div class="text-current">${asset.text || html`<span class="muted">(empty)</span>`}</div>
      ${m.context && html`<div class="text-context"><${Icon} name="pin" size=${12} /> ${m.context}</div>`}
    </div>
    <div class="text-pane">
      <div class="pane-label"><span class="pane-title">Replacement</span><span class="pane-sub">${asset.replacementText ? (rep && rep.by ? 'by ' + shortActor(rep.by) : '') : readOnly ? '' : `type a new version — saves on blur or ${modKey}+Enter`}</span>
        ${!readOnly && asset.replacementText && html`<button type="button" class="btn btn-ghost btn-xs as-text-remove" onClick=${() => removeReplacement(asset.id)}><${Icon} name="x" size=${12} /><span>Remove replacement</span></button>`}</div>
      <${TextReplacementEditor} asset=${asset} rows=${4} inputRef=${inputRef} readOnly=${readOnly} />
    </div>
  </div>`;
}

// ---------------------------------------------------------------- status buttons
/** onBefore(k) may return a note for the status change (e.g. the notes the designer just typed). */
export function StatusButtons({ asset, onDone, showKeys, readOnly, noteFor }) {
  return html`<div class="status-buttons" role="group" aria-label="Review status">
    ${STATUSES.map((k) => {
      const s = STATUS[k];
      const dis = readOnly || (k === 'replaced' && !asset.hasReplacement && asset.status !== 'replaced');
      const keyHint = { pending_review: 'P', needs_replacement: 'X', approved: 'A', replaced: '' }[k];
      return html`<button type="button" key=${k} class=${cx('status-btn', 'st-' + s.cls, asset.status === k && 'is-active')}
        aria-pressed=${String(asset.status === k)} disabled=${dis}
        title=${readOnly ? 'Read-only access' : dis ? 'Attach a replacement first' : s.meaning}
        onClick=${() => { if (asset.status !== k) changeStatus(asset.id, k, { note: noteFor ? noteFor(k) : '' }).then((r) => r && r.status === 'saved' && onDone && onDone(k)); }}>
        <${Icon} name=${s.icon} size=${14} /><span>${s.short}</span>${showKeys && keyHint && !readOnly && html`<kbd class="kbd kbd-sm">${keyHint}</kbd>`}
      </button>`;
    })}
  </div>`;
}

// ---------------------------------------------------------------- metadata table
export function MetaTable({ asset }) {
  const m = asset.meta || {};
  const rows = [];
  const add = (k, v, mono) => { if (v != null && v !== '' && !(Array.isArray(v) && !v.length)) rows.push({ k, v, mono }); };
  add('Path', asset.path, true);
  add('Asset id', asset.id, true);
  add('Kind', KIND_LABEL[asset.kind] || asset.kind);
  add('Size', m.w && m.h ? `${m.w}×${m.h} px` : null, true);
  add('Filter', m.filter);
  add('Pixels per unit', m.ppu, true);
  add('Frames', m.frames ? `${m.frames.cols || 1}×${m.frames.rows || 1}${m.frames.fps ? ` @ ${m.frames.fps} fps` : ''}` : null);
  add('Sprite name', m.spriteName, true);
  add('Godot UID', m.godotUid, true);
  add('Unity GUID', m.unityGuid, true);
  add('Localization key', m.key, true);
  add('Max characters', m.maxChars, true);
  add('Context', m.context);
  add('Preview bg', m.bg, true);
  if (Array.isArray(m.usedIn) && m.usedIn.length) rows.push({ k: 'Used in', v: html`<span class="chip-list">${m.usedIn.map((u) => html`<span class="tag mono" key=${u}>${u}</span>`)}</span>` });
  if (Array.isArray(m.tags) && m.tags.length) rows.push({ k: 'Tags', v: html`<span class="chip-list">${m.tags.map((u) => html`<span class="tag" key=${u}>${u}</span>`)}</span>` });
  if (asset.contentHash) rows.push({ k: 'File version', v: html`<span class="mono" title=${asset.contentHash}>${asset.contentHash.slice(0, 12)}</span>` });
  return html`<dl class="meta-table">
    ${rows.map((r) => html`<div class="meta-row" key=${r.k}><dt>${r.k}</dt><dd class=${r.mono ? 'mono' : ''}>${r.v}</dd></div>`)}
  </dl>`;
}

export function Translations({ asset }) {
  const tr = asset.meta && asset.meta.translations;
  if (!tr || typeof tr !== 'object' || !Object.keys(tr).length) return null;
  const max = Number(asset.meta.maxChars) || 0;
  return html`<div class="translations">
    <div class="note note-warn"><${Icon} name="languages" size=${14} /><span>Translations are read-only here. Changing the English text means every language below must be re-translated.</span></div>
    <dl class="meta-table">
      ${Object.entries(tr).map(([lang, t]) => {
        const n = [...String(t)].length;
        return html`<div class="meta-row" key=${lang}><dt>${lang}</dt><dd>${String(t)} ${max ? html`<span class=${cx('charcount', n > max && 'is-over')}>${n}/${max}</span>` : null}</dd></div>`;
      })}
    </dl>
  </div>`;
}

// ---------------------------------------------------------------- review history (entry.history, newest first)
export function HistoryList({ asset }) {
  const items = asset.history.slice().reverse();
  if (!items.length) return html`<p class="muted">No review history yet. Every status change, replacement and new game version is recorded here.</p>`;
  return html`<ol class="as-history">
    ${items.map((h, i) => {
      const s = STATUS[h.status];
      const at = Date.parse(h.at);
      const older = h.contentHash && asset.contentHash && h.contentHash !== asset.contentHash;
      return html`<li class="as-hist" key=${i}>
        <${Avatar} actor=${h.by} size=${22} />
        <div class="as-hist-main">
          <div class="as-hist-head">
            <b>${shortActor(h.by)}</b>
            ${s ? html`<span class=${'pill pill-sm st-' + s.cls}><${Icon} name=${s.icon} size=${11} class="pill-icon" /><span class="pill-label">${s.label}</span></span>` : html`<span>${h.status}</span>`}
            <time class="muted" title=${fullTime(at)}>${relTime(at)}</time>
          </div>
          ${h.note && html`<div class="as-hist-note">${h.note}</div>`}
          ${older && html`<div class="as-hist-old muted"><${Icon} name="history" size=${11} /> about an earlier version of the file</div>`}
        </div>
      </li>`;
    })}
  </ol>`;
}
