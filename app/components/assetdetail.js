// Asset detail: large side panel over the current view (opened by ?asset=<id>; Esc/close removes it).
// Compare stage, status, notes, capture, translations, discussion, metadata and review history.
import { html, cx, KIND_LABEL, KIND_ICON, copyText, shortActor, relTime, fullTime, STATUS, isTypingTarget } from '../lib.js';
import { useEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { Icon } from '../icons.js';
import { Portal, useLayer, useBodyLock, topOverlay } from './overlay.js';
import { useStore } from '../store.js';
import { href, useRoute } from '../router.js';
import { repoStore } from '../repo.js';
import { useViewAsset, useCanEdit, useProject, saveNotes, attachFile, statusLabel } from '../assets.js';
import { discussStore } from '../discuss.js';
import { CompareStage, TextStage, StatusButtons, MetaTable, Translations, HistoryList } from './stage.js';
import { ScreenshotFull } from './screenshot.js';
import { AutoTextarea, Tabs, EmptyState } from './ui.js';
import { toast } from './toast.js';
import { usePasteTarget } from './replace.js';
import { cycleBg } from './pixelimage.js';
import { AssetDiscussion, openThreadCount } from '../assets/discussion.js';

export function NotesEditor({ asset, inputRef, placeholder, readOnly, liveRef }) {
  const [val, setVal] = useState(asset.notes || '');
  const [dirty, setDirty] = useState(false);
  useEffect(() => { if (!dirty) setVal(asset.notes || ''); }, [asset.notes, asset.id]);
  if (liveRef) liveRef.current = val;
  const save = () => { if (!dirty) return; setDirty(false); saveNotes(asset.id, val); };
  if (readOnly) {
    return html`<div class="notes-editor">${asset.notes ? html`<p class="as-notes-read">${asset.notes}</p>` : html`<p class="muted">No notes.</p>`}</div>`;
  }
  return html`<div class="notes-editor">
    <${AutoTextarea} inputRef=${inputRef} value=${val} minRows=${2} maxRows=${8}
      placeholder=${placeholder || 'What needs to change? (saved when you click away)'}
      onInput=${(e) => { setVal(e.currentTarget.value); setDirty(true); }} onBlur=${save} aria-label="Review notes"
      onKeyDown=${(e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); save(); e.currentTarget.blur(); }
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (dirty) save(); e.currentTarget.blur(); }
      }} />
    <div class="notes-meta muted as-notes-meta">
      <span>${dirty ? 'Unsaved — click away or Ctrl+Enter to save' : asset.pending && asset.notes !== (asset.entry.notes || '') ? 'Saving…' : asset.notes ? 'Saved' : 'Notes are shown in the review table and passed on to whoever replaces the asset.'}</span>
      ${dirty && html`<button type="button" class="btn btn-secondary btn-xs" onMouseDown=${(e) => e.preventDefault()} onClick=${save}>Save notes</button>`}
    </div>
  </div>`;
}

export function AssetDetailOverlay({ id, onClose }) {
  const ref = useRef(null);
  useLayer(ref, { onEscape: onClose });
  useBodyLock();
  return html`<${Portal}>
    <div class="scrim scrim-detail" onMouseDown=${(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div class="detail as-detail" role="dialog" aria-modal="true" aria-label="Asset detail" ref=${ref} tabindex="-1">
        <${AssetDetail} id=${id} onClose=${onClose} layerRef=${ref} />
      </div>
    </div>
  <//>`;
}

function CloseBtn({ onClose }) {
  return html`<button type="button" class="icon-btn" aria-label="Close (Esc)" title="Close (Esc)" onClick=${onClose}><${Icon} name="x" size=${18} /></button>`;
}

function AssetDetail({ id, onClose, layerRef }) {
  const a = useViewAsset(id);
  const canEdit = useCanEdit();
  const readOnly = !canEdit;
  const project = useProject();
  const groups = useStore(repoStore, (s) => s.groups);
  const threads = useStore(discussStore, (s) => s.threads);
  const route = useRoute();
  const [zoom, setZoom] = useState(null);
  const [mode, setMode] = useState('side');
  const [tab, setTab] = useState('discussion');
  const uploadRef = useRef(null);
  const notesInput = useRef(null);
  const notesLive = useRef('');
  usePasteTarget((f) => attachFile(id, f), !!a && !readOnly && a.kind !== 'text');

  useEffect(() => {
    const onKey = (e) => {
      if (isTypingTarget(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      const top = topOverlay();
      if (layerRef && top && top.ref !== layerRef) return; // a dialog or menu is above the panel
      if (e.key === '+' || e.key === '=') { e.preventDefault(); setZoom((z) => Math.min(8, (z || 1) + 1)); }
      else if (e.key === '-' || e.key === '_') { e.preventDefault(); setZoom((z) => Math.max(1, (z || 2) - 1)); }
      else if (e.key === '0') { setZoom(null); }
      else if (e.key === 'b' || e.key === 'B') { cycleBg(project); }
      else if ((e.key === 'u' || e.key === 'U') && uploadRef.current) { e.preventDefault(); uploadRef.current(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [id, project]);

  const copyLink = async () => {
    const url = location.href;
    const ok = await copyText(url);
    if (ok) toast('Link copied', { kind: 'success', duration: 1800 });
    else toast('Your browser blocked the clipboard — copy the link from here:', { kind: 'info', detail: url, duration: 12000 });
  };

  if (!a) {
    return html`<div class="detail-head"><div class="detail-title-row"><h2 class="detail-title">Asset</h2><span class="spacer"></span><${CloseBtn} onClose=${onClose} /></div></div>
      <div class="detail-body"><${EmptyState} icon="image" title="This asset isn't in the review any more">
        <code>${id}</code> is not in the asset manifests. It may have been renamed or removed from the game.<//></div>`;
  }
  const isText = a.kind === 'text';
  const g = groups.find((x) => x.id === a.group);
  const nOpen = openThreadCount(threads, a.id);
  const last = a.history[a.history.length - 1];
  const noteFor = (k) => (k === 'needs_replacement' || k === 'approved' ? (notesLive.current || '').trim() : '');
  const onStatusDone = (k) => {
    if (k === 'needs_replacement' && !(notesLive.current || '').trim() && notesInput.current) {
      notesInput.current.focus();
      toast('Say in the notes what needs to change', { kind: 'info', duration: 3000 });
    }
  };
  const inAssets = route.section === 'assets';
  return html`
    <div class="detail-head">
      <div class="detail-crumbs muted">
        ${g ? html`<a href=${href.assets(g.id)}>${g.title}</a>` : html`<span>${a.group}</span>`}
        <${Icon} name="chevron-right" size=${12} />
        <span class=${'kind kind-' + a.kind}><${Icon} name=${KIND_ICON[a.kind] || 'file'} size=${11} />${KIND_LABEL[a.kind] || a.kind}</span>
        ${a.archived ? html`<span class="badge badge-warn"><${Icon} name="archive" size=${11} /> Archived</span>` : null}
        ${a.stale ? html`<span class="badge badge-warn" title="The game's file changed since this review entry was written">Changed in game</span>` : null}
        ${readOnly && html`<span class="badge badge-neutral"><${Icon} name="eye" size=${11} /> Read-only</span>`}
      </div>
      <div class="detail-title-row">
        <h2 class="detail-title">${a.name}</h2>
        <span class="spacer"></span>
        <button type="button" class="btn btn-ghost btn-sm" onClick=${copyLink}><${Icon} name="link" size=${14} /><span class="btn-label hide-sm">Copy link</span></button>
        ${!inAssets && html`<a class="btn btn-ghost btn-sm" href=${href.asset(a.id, a.group)}><${Icon} name="image" size=${14} /><span class="btn-label hide-sm">Open in Assets</span></a>`}
        <${CloseBtn} onClose=${onClose} />
      </div>
      ${a.path && html`<div class="detail-path mono" title=${a.path}>${a.path}</div>`}
    </div>
    <div class="detail-body">
      <section class="detail-stage" aria-label="Compare">
        ${isText ? html`<${TextStage} asset=${a} readOnly=${readOnly} />`
          : html`<${CompareStage} asset=${a} zoom=${zoom} setZoom=${setZoom} mode=${mode} setMode=${setMode} uploadRef=${uploadRef} readOnly=${readOnly} />`}
      </section>
      <div class="detail-cols">
        <div class="detail-main">
          <section class="detail-section">
            <h3 class="section-title">Review</h3>
            <${StatusButtons} asset=${a} readOnly=${readOnly} noteFor=${noteFor} onDone=${onStatusDone} />
            <div class="status-meta muted">
              ${last ? html`${statusLabel(last.status)} · ${shortActor(last.by)} · <time title=${fullTime(Date.parse(last.at))}>${relTime(Date.parse(last.at))}</time>`
                : STATUS[a.status] ? STATUS[a.status].meaning : ''}
            </div>
            <label class="label-sm as-notes-label">Notes</label>
            <${NotesEditor} asset=${a} readOnly=${readOnly} inputRef=${notesInput} liveRef=${notesLive} />
          </section>
          ${a.capture && html`<section class="detail-section">
            <h3 class="section-title">In game</h3>
            <${ScreenshotFull} asset=${a} maxH=${440} />
          </section>`}
          ${isText && html`<section class="detail-section"><h3 class="section-title">Translations</h3>
            ${a.meta.translations && Object.keys(a.meta.translations).length ? html`<${Translations} asset=${a} />` : html`<p class="muted">No translations recorded for this string.</p>`}</section>`}
        </div>
        <aside class="detail-side">
          <${Tabs} idPrefix="assettab" label="Asset information" value=${tab} onChange=${setTab} size="sm" tabs=${[
            { id: 'discussion', label: 'Discussion', count: nOpen || null },
            { id: 'details', label: 'Details' },
            { id: 'history', label: 'History', count: a.history.length || null },
          ]} />
          <div class=${cx('detail-tabpanel')} role="tabpanel" aria-labelledby=${'assettab-' + tab}>
            ${tab === 'discussion' && html`<${AssetDiscussion} asset=${a} />`}
            ${tab === 'details' && html`<${MetaTable} asset=${a} />`}
            ${tab === 'history' && html`<${HistoryList} asset=${a} />`}
          </div>
        </aside>
      </div>
    </div>`;
}
