// Replacement input: drag-drop, click-to-browse, paste (Ctrl+V); pixel-art check chips; text replacement editor.
// Works on view assets (assets.js); every write goes through assets.js → repo.js (one change each).
import { html, cx, isTypingTarget, modKey } from '../lib.js';
import { useEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { Icon } from '../icons.js';
import { attachFile, attachText, removeReplacement, assetDims, useRepoImage, useProject } from '../assets.js';
import { assetById } from '../repo.js';
import { analyzeImage, pixelChecks } from '../pixel.js';
import { PixelImage } from './pixelimage.js';
import { toast } from './toast.js';

export function pickFile(accept = 'image/png,image/*') {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.className = 'as-file-input';
    input.style.position = 'fixed';
    input.style.left = '-9999px';
    document.body.appendChild(input);
    input.addEventListener('change', () => { resolve(input.files && input.files[0] ? input.files[0] : null); input.remove(); }, { once: true });
    input.addEventListener('cancel', () => { resolve(null); input.remove(); }, { once: true });
    input.click();
  });
}

export function fileFromClipboard(e) {
  const dt = e.clipboardData;
  if (!dt) return null;
  for (const it of dt.items || []) {
    if (it.kind === 'file') {
      const f = it.getAsFile();
      if (f) return f.name ? f : new File([f], 'pasted.png', { type: f.type || 'image/png' });
    }
  }
  return null;
}

export function acceptFor(kind) {
  if (kind === 'text') return 'text/plain,.txt,.md';
  return 'image/png,image/jpeg,image/webp,image/gif';
}

// ---------------------------------------------------------------- global paste routing
const pasteStack = [];
export function usePasteTarget(fn, active = true) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (!active) return undefined;
    const entry = (f) => ref.current(f);
    pasteStack.push(entry);
    return () => { const i = pasteStack.indexOf(entry); if (i >= 0) pasteStack.splice(i, 1); };
  }, [active]);
}

document.addEventListener('paste', (e) => {
  const file = fileFromClipboard(e);
  if (!file) return;
  const ae = document.activeElement;
  const target = ae && ae.closest ? ae.closest('[data-paste-asset]') : null;
  if (target) {
    e.preventDefault();
    const id = target.getAttribute('data-paste-asset');
    if (id && assetById(id)) attachFile(id, file);
    return;
  }
  if (isTypingTarget(ae)) return;
  const top = pasteStack[pasteStack.length - 1];
  if (top) { e.preventDefault(); top(file); }
});

// ---------------------------------------------------------------- drag & drop hook
export function useFileDrop(onFile, { disabled } = {}) {
  const [over, setOver] = useState(false);
  const depth = useRef(0);
  const has = (e) => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
  return {
    over,
    props: disabled ? {} : {
      onDragEnter: (e) => { if (!has(e)) return; e.preventDefault(); depth.current++; setOver(true); },
      onDragOver: (e) => { if (!has(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; },
      onDragLeave: () => { depth.current = Math.max(0, depth.current - 1); if (!depth.current) setOver(false); },
      onDrop: (e) => {
        if (!has(e)) return;
        e.preventDefault();
        depth.current = 0;
        setOver(false);
        const f = e.dataTransfer.files && e.dataTransfer.files[0];
        if (f) onFile(f);
      },
    },
  };
}

// ---------------------------------------------------------------- check chips
/** Pixel-art checks for a replacement image src (size vs current always; the rest when settings.pixelArt.enabled). */
export function useChecks(asset, src) {
  const project = useProject();
  const settings = project.settings && project.settings.pixelArt;
  const [checks, setChecks] = useState(null);
  useEffect(() => {
    let alive = true;
    setChecks(null);
    if (!src || !asset || asset.kind === 'text') return undefined;
    analyzeImage(src).then((res) => {
      if (!alive || !res) return;
      setChecks(pixelChecks(res, { settings, currentDims: assetDims(asset) }));
    });
    return () => { alive = false; };
  }, [src, asset && asset.id, settings]);
  return checks;
}

export function CheckChips({ checks, compact }) {
  if (!checks || !checks.length) return null;
  return html`<div class=${cx('checks', compact && 'checks-compact')}>
    ${checks.map((c) => html`<span key=${c.id} class=${cx('check-chip', c.ok ? (c.info ? 'is-info' : 'is-ok') : 'is-warn')} title=${c.title}>
      <${Icon} name=${c.ok ? 'check' : 'alert'} size=${11} /><span>${c.label}</span>
    </span>`)}
  </div>`;
}

// One compact chip for table rows: "✓ Checks OK" or "⚠ N issues" (details in the tooltip and the detail panel).
export function CheckSummary({ checks }) {
  if (!checks || !checks.length) return html`<span class="check-chip check-chip-placeholder" aria-hidden="true"></span>`;
  const bad = checks.filter((c) => !c.ok);
  const title = checks.map((c) => `${c.ok ? '✓' : '⚠'} ${c.title}`).join('\n');
  return html`<span class=${cx('check-chip', bad.length ? 'is-warn' : 'is-ok')} title=${title} aria-label=${title}>
    <${Icon} name=${bad.length ? 'alert' : 'check'} size=${11} /><span>${bad.length ? `${bad.length} issue${bad.length === 1 ? '' : 's'}` : 'Checks OK'}</span>
  </span>`;
}

/** blob: URL of the replacement image (local preview while uploading, else the repo file). */
export function useReplacementSrc(asset) {
  const img = useRepoImage(asset && !asset.localUrl ? asset.replacementPath : null);
  return asset ? asset.localUrl || img.src : null;
}

// ---------------------------------------------------------------- table cell drop zone
export function ReplacementDrop({ asset, boxW = 72, boxH = 72, readOnly }) {
  const replSrc = useReplacementSrc(asset);
  const onFile = (f) => attachFile(asset.id, f);
  const { over, props } = useFileDrop(onFile, { disabled: readOnly });
  const checks = useChecks(asset, replSrc);
  const browse = async () => { const f = await pickFile(acceptFor(asset.kind)); if (f) onFile(f); };
  if (asset.hasReplacement) {
    const thumb = html`<${PixelImage} src=${replSrc} boxW=${boxW} boxH=${boxH} meta=${asset.meta} alt=${`Replacement for ${asset.name}`} />`;
    return html`<div class=${cx('repl', over && 'is-over')} ...${props}>
      <div class="repl-thumb">
        ${readOnly ? html`<div class="repl-thumb-btn as-repl-ro">${thumb}</div>`
          : html`<button type="button" class="repl-thumb-btn" data-paste-asset=${asset.id} onClick=${browse}
              title=${`Replacement — click or drop to swap, ${modKey}+V to paste`}
              aria-label=${`Replacement for ${asset.name}. Click to choose a different file`}>
              ${thumb}
              ${asset.uploading && html`<span class="repl-uploading"><span class="spinner spinner-sm"></span></span>`}
            </button>
            <button type="button" class="repl-clear" aria-label=${`Remove replacement for ${asset.name}`} title="Remove replacement" onClick=${() => removeReplacement(asset.id)}>
              <${Icon} name="x" size=${12} />
            </button>`}
      </div>
      <${CheckSummary} checks=${checks} />
    </div>`;
  }
  if (readOnly) return html`<div class="as-repl-none muted" style=${{ width: boxW + 'px', height: boxH + 'px' }}>None</div>`;
  return html`<button type="button" class=${cx('dropzone', over && 'is-over')} style=${{ width: boxW + 'px', height: boxH + 'px' }}
      data-paste-asset=${asset.id} data-drop-asset=${asset.id} onClick=${browse} ...${props}
      aria-label=${`Attach a replacement for ${asset.name}: click to browse, drop a file, or paste`}>
    <${Icon} name="upload" size=${16} />
    <span>Drop PNG<br />or click</span>
  </button>`;
}

// ---------------------------------------------------------------- text replacement editor
export function TextReplacementEditor({ asset, rows = 2, autoFocus, compact, inputRef, lazy, readOnly }) {
  const saved = asset.replacementText || '';
  const [active, setActive] = useState(!lazy);
  const [val, setVal] = useState(saved);
  const [dirty, setDirty] = useState(false);
  const ref = useRef(null);
  useEffect(() => { if (!dirty) setVal(saved); }, [saved]);
  // (the autofocus attribute only works once per document, so focus explicitly)
  useEffect(() => { if (lazy && active && ref.current) { ref.current.focus(); const n = ref.current.value.length; ref.current.setSelectionRange(n, n); } }, [active]);
  const max = asset.meta && Number(asset.meta.maxChars);
  const len = [...val].length;
  const over = max && len > max;
  // refs, not state, decide what blur saves: Esc/Ctrl+Enter blur in the same tick as their state updates
  const live = useRef({ val, dirty });
  live.current.val = val;
  live.current.dirty = dirty;
  const save = () => {
    if (!live.current.dirty) return;
    live.current.dirty = false;
    setDirty(false);
    const t = live.current.val.replace(/\s+$/, '');
    if (t === saved) return;
    attachText(asset.id, t);
  };
  const onKey = (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); save(); e.currentTarget.blur(); }
    else if (e.key === 'Escape') {
      e.stopPropagation(); e.preventDefault();
      live.current.dirty = false;
      live.current.val = saved;
      setVal(saved); setDirty(false); e.currentTarget.blur();
    }
  };
  const setRef = (el) => { ref.current = el; if (inputRef) inputRef.current = el; };
  if (readOnly) {
    return html`<div class=${cx('text-repl', compact && 'text-repl-compact')}>
      ${saved ? html`<div class="text-repl-btn as-text-ro"><span class="text-repl-val">${saved}</span></div>
        <div class="text-repl-meta"><span class=${cx('charcount', over && 'is-over')}>${len}${max ? ` / ${max}` : ''}</span></div>`
        : html`<span class="muted as-repl-none-text">No replacement</span>`}
    </div>`;
  }
  // In long tables the editor is a light button until used (hundreds of live textareas are slow).
  if (lazy && !active && !dirty) {
    return html`<div class=${cx('text-repl', compact && 'text-repl-compact')}>
      <button type="button" class=${cx('text-repl-btn', !saved && 'is-empty', over && 'is-over')} onClick=${() => setActive(true)} onFocus=${() => setActive(true)}
        aria-label=${`Replacement text for ${asset.name}${saved ? ': ' + saved : ' (none)'}. Activate to edit`}>
        ${saved ? html`<span class="text-repl-val">${saved}</span>` : html`<span class="muted">Type replacement text…</span>`}
      </button>
      ${saved ? html`<div class="text-repl-meta"><span class=${cx('charcount', over && 'is-over')}>${len}${max ? ` / ${max}` : ''}</span>${asset.pending && html`<span class="muted">Saving…</span>`}</div>` : null}
    </div>`;
  }
  return html`<div class=${cx('text-repl', compact && 'text-repl-compact')}>
    <textarea ref=${setRef} class=${cx('input textarea', over && 'is-over')} rows=${rows} value=${val} autoFocus=${autoFocus || (lazy && active)}
      placeholder=${saved ? '' : 'Type replacement text…'} aria-label=${`Replacement text for ${asset.name}`}
      onInput=${(e) => { setVal(e.currentTarget.value); setDirty(true); }} onBlur=${() => { save(); if (lazy) setActive(false); }} onKeyDown=${onKey}></textarea>
    <div class="text-repl-meta">
      <span class=${cx('charcount', over && 'is-over')} title=${max ? `Limit ${max} characters` : 'Characters'}>${len}${max ? ` / ${max}` : ''}</span>
      ${over && html`<span class="warn-text"><${Icon} name="alert" size=${11} /> ${len - max} over</span>`}
      ${dirty ? html`<span class="muted">${modKey}+Enter or click away to save · Esc reverts</span>` : asset.pending ? html`<span class="muted">Saving…</span>` : saved ? html`<span class="muted">Saved</span>` : null}
    </div>
  </div>`;
}

export function notifyDropHint() {
  toast(`Drop a PNG on the row, click the drop zone, or focus it and press ${modKey}+V.`, { kind: 'info' });
}
