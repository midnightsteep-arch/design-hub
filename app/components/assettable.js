// Asset review table: group header (progress + filter chips), bulk bar, memoized rows, 100-row pages.
// Rows are view assets (assets.js). Opening a row adds ?asset=<id> to the current route (the detail overlay).
import { html, cx, STATUS, STATUSES, KIND_LABEL, KIND_ICON, fmtInt, relTime, fullTime, shortActor, plural, modKey } from '../lib.js';
import { useCallback, useEffect, useMemo, useRef, useState } from '../../vendor/hooks.module.js';
import { Icon } from '../icons.js';
import { memo, useStore } from '../store.js';
import { router, toQuery, href, useRoute } from '../router.js';
import { changeStatus, saveNotes, bulkStatus, matchesQuery, countStatuses, lastEvent, useRepoImage, useProject } from '../assets.js';
import { discussStore } from '../discuss.js';
import { PixelImage, BgToggle } from './pixelimage.js';
import { ScreenshotCrop } from './screenshot.js';
import { StatusSelect, ProgressBar, StatusChips } from './status.js';
import { ReplacementDrop, TextReplacementEditor } from './replace.js';
import { EmptyState, Skeleton, Btn, useOnScreen, useDebounced, useElementWidth } from './ui.js';
import { openThreadCount, ThreadBadge } from '../assets/discussion.js';

const PAGE = 100;

/** Link that opens the asset detail over the current view (keeps the route, adds ?asset=). */
export function detailHref(id, base) {
  if (base == null) base = hrefBase(router.get().route);
  return base + (base.includes('?') ? '&' : '?') + 'asset=' + encodeURIComponent(id);
}
/** The current route without ?asset= (rows build their detail links from it). */
export function hrefBase(route) {
  const q = { ...route.query };
  delete q.asset;
  return route.hash.split('?')[0] + toQuery(q);
}

/** A repo image in a pixel-perfect box. */
export function RepoThumb({ path, src: srcProp, boxW, boxH, meta, alt }) {
  const img = useRepoImage(srcProp ? null : path);
  const src = srcProp || img.src;
  if (!src && img.loading) return html`<${Skeleton} w=${boxW} h=${boxH} r="6px" />`;
  return html`<${PixelImage} src=${src} boxW=${boxW} boxH=${boxH} hintW=${meta && meta.w} hintH=${meta && meta.h} meta=${meta} alt=${alt} />`;
}

// ---------------------------------------------------------------- Notes cell
function NotesCell({ a, readOnly, threads, detail }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(a.notes || '');
  const ref = useRef(null);
  useEffect(() => { if (!editing) setVal(a.notes || ''); }, [a.notes, editing]);
  useEffect(() => { if (editing && ref.current) { ref.current.focus(); ref.current.select(); } }, [editing]);
  const commit = () => { setEditing(false); if ((val || '').trim() !== (a.notes || '')) saveNotes(a.id, val); };
  return html`<div class="notes-cell">
    ${editing
      ? html`<textarea ref=${ref} class="input textarea notes-input" rows="2" value=${val} aria-label=${`Notes for ${a.name}`}
          onInput=${(e) => setVal(e.currentTarget.value)} onBlur=${commit}
          onKeyDown=${(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commit(); }
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setVal(a.notes || ''); setEditing(false); }
          }}></textarea>`
      : readOnly
        ? html`<div class="notes-btn as-notes-ro">${a.notes ? html`<span class="notes-text">${a.notes}</span>` : html`<span class="muted">—</span>`}</div>`
        : html`<button type="button" class=${cx('notes-btn', !a.notes && 'is-empty')} onClick=${() => setEditing(true)} title=${a.notes ? 'Edit note' : 'Add a note'}>
          ${a.notes ? html`<span class="notes-text">${a.notes}</span>` : html`<span class="notes-ph"><${Icon} name="edit" size=${12} /> Add note</span>`}
        </button>`}
    <${ThreadBadge} n=${threads} href=${detail} name=${a.name} />
  </div>`;
}

// In-game crop: 148×84 in the table grid; fills the card width (same aspect) when rows become cards.
function FluidShot({ asset, onClick }) {
  const ref = useRef(null);
  const w = useElementWidth(ref);
  const boxW = w > 170 ? Math.min(w, 320) : 148;
  const boxH = w > 170 && !asset.capture ? 32 : Math.round(boxW * 84 / 148);
  return html`<div class="shot-fluid" ref=${ref}><${ScreenshotCrop} asset=${asset} boxW=${boxW} boxH=${boxH} onClick=${onClick} /></div>`;
}

// ---------------------------------------------------------------- Row
function AssetRowInner({ a, selected, onSelect, thumb = 72, readOnly, threads, selectable, base }) {
  const isText = a.kind === 'text';
  const detail = detailHref(a.id, base);
  const go = () => { location.hash = detail; };
  const ev = lastEvent(a);
  const m = a.meta || {};
  const dims = m.w && m.h ? `${m.w}×${m.h}` : null;
  const max = Number(m.maxChars) || 0;
  const curLen = a.text != null ? [...a.text].length : 0;
  return html`<div class=${cx('arow', selected && 'is-selected', isText && 'arow-text', a.pending && 'is-pending')} role="row" data-id=${a.id}>
    <div class="ac ac-sel" role="cell">
      ${selectable && html`<input type="checkbox" class="checkbox" checked=${selected} aria-label=${`Select ${a.name}`} onClick=${(e) => onSelect(a.id, e)} />`}
    </div>
    <div class="ac ac-asset" role="cell">
      <a class="asset-name" href=${detail}>${a.name}</a>
      <div class="asset-sub">
        <span class=${'kind kind-' + a.kind} title=${KIND_LABEL[a.kind] || a.kind}><${Icon} name=${KIND_ICON[a.kind] || 'file'} size=${11} />${KIND_LABEL[a.kind] || a.kind}</span>
        ${dims && html`<span class="mono dim">${dims}</span>`}
        ${isText && max ? html`<span class=${cx('mono dim', curLen > max && 'warn-text')} title=${`Current text: ${curLen} of ${max} characters`}>${curLen}/${max}</span>` : null}
        ${a.stale && html`<span class="ver" title="The game's file changed since this was reviewed — a developer will refresh the review">changed</span>`}
      </div>
      ${a.path && !isText && html`<div class="asset-path mono" title=${a.path}>${a.path}</div>`}
      ${isText && m.key && html`<div class="asset-path mono" title=${m.context || m.key}>${m.context || m.key}</div>`}
      ${ev && html`<div class="asset-upd-inline muted">${relTime(ev.at)}${ev.by ? ' · ' + shortActor(ev.by) : ''}</div>`}
    </div>
    <div class="ac ac-cur" role="cell">
      ${isText
        ? html`<button type="button" class="cur-text" onClick=${go} title="Open detail"><span class="cur-text-inner">${a.text || html`<span class="muted">(empty)</span>`}</span></button>`
        : html`<button type="button" class="thumb-btn" onClick=${go} aria-label=${`Open ${a.name}`}>
            <${RepoThumb} path=${a.path} boxW=${thumb} boxH=${thumb} meta=${m} alt=${a.name} />
          </button>`}
    </div>
    <div class="ac ac-shot" role="cell">
      <${FluidShot} asset=${a} onClick=${go} />
    </div>
    <div class="ac ac-repl" role="cell">
      ${isText ? html`<${TextReplacementEditor} asset=${a} compact lazy readOnly=${readOnly} />` : html`<${ReplacementDrop} asset=${a} boxW=${thumb} boxH=${thumb} readOnly=${readOnly} />`}
    </div>
    <div class="ac ac-status" role="cell">
      <${StatusSelect} status=${a.status} hasReplacement=${a.hasReplacement} readOnly=${readOnly} busy=${a.pending}
        onChange=${(s) => changeStatus(a.id, s)} />
    </div>
    <div class="ac ac-notes" role="cell"><${NotesCell} a=${a} readOnly=${readOnly} threads=${threads} detail=${detail} /></div>
    <div class="ac ac-upd" role="cell">
      ${ev ? html`<time class="upd-time" datetime=${new Date(ev.at).toISOString()} title=${fullTime(ev.at)}>${relTime(ev.at)}</time>
        ${ev.by && html`<span class="upd-by">${shortActor(ev.by)}</span>`}` : html`<span class="upd-by">—</span>`}
    </div>
  </div>`;
}
export const AssetRow = memo(AssetRowInner);

// ---------------------------------------------------------------- Bulk bar
function BulkBar({ n, onStatus, onClear, onSelectAll, allVisible }) {
  return html`<div class="bulkbar" role="region" aria-label="Bulk actions">
    <span class="bulk-n"><b>${fmtInt(n)}</b> selected</span>
    ${!allVisible && html`<button type="button" class="btn btn-ghost btn-xs" onClick=${onSelectAll}>Select all matching</button>`}
    <span class="bulk-sep"></span>
    <span class="bulk-label">Set status</span>
    ${STATUSES.map((k) => html`<button type="button" key=${k} class=${'btn btn-xs bulk-st st-' + STATUS[k].cls} onClick=${() => onStatus(k)}>
      <${Icon} name=${STATUS[k].icon} size=${12} /><span>${STATUS[k].short}</span></button>`)}
    <span class="spacer"></span>
    <button type="button" class="btn btn-ghost btn-xs" onClick=${onClear}><${Icon} name="x" size=${12} /><span>Clear</span></button>
  </div>`;
}

// ---------------------------------------------------------------- Group table
/**
 * group: {id,title,description}; assets: view assets of the group.
 * status/onStatus and q: controlled filters (else local). mode: 'page' (group page) | 'hub' (overview list) | 'embed' (page directive).
 */
export function AssetGroupTable({ group, assets, status: statusProp, onStatus, q: qProp, mode = 'embed', lazy = true, headerLink = true, readOnly }) {
  const [statusLocal, setStatusLocal] = useState('');
  const [qLocal, setQLocal] = useState('');
  const dq = useDebounced(qLocal, 150);
  const status = statusProp != null ? statusProp : statusLocal;
  const setStatusF = onStatus || setStatusLocal;
  const q = qProp != null ? qProp : dq;
  const [limit, setLimit] = useState(PAGE);
  const [sel, setSel] = useState(() => new Set());
  const lastIdx = useRef(-1);
  const project = useProject();
  const threads = useStore(discussStore, (s) => s.threads);
  const base = hrefBase(useRoute());
  const secRef = useRef(null);
  const seen = useOnScreen(secRef, '900px');
  const show = !lazy || seen;
  const list = assets || [];
  const g = group || { id: '', title: 'Assets' };

  const liveCounts = countStatuses(q ? list.filter((a) => matchesQuery(a, q)) : list);
  // Rows that matched the current filter stay visible after their status changes (until the filter changes),
  // so approving an item under "Pending" doesn't make the table jump.
  const shown = useRef({ key: '', set: new Set() });
  const fkey = status + '|' + q + '|' + g.id;
  if (shown.current.key !== fkey) shown.current = { key: fkey, set: new Set() };
  const filtered = list.filter((a) => {
    if (q && !matchesQuery(a, q)) return false;
    if (status && a.status !== status && !shown.current.set.has(a.id)) return false;
    shown.current.set.add(a.id);
    return true;
  });
  const visible = filtered.slice(0, limit);
  useEffect(() => { setLimit(PAGE); }, [status, q]);
  useEffect(() => { setSel(new Set()); lastIdx.current = -1; }, [g.id, status, q]);

  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  const onSelect = useCallback((id, e) => {
    setSel((prev) => {
      const next = new Set(prev);
      const ids = visibleRef.current.map((a) => a.id);
      const idx = ids.indexOf(id);
      if (e.shiftKey && lastIdx.current >= 0 && idx >= 0) {
        const [x, y] = lastIdx.current < idx ? [lastIdx.current, idx] : [idx, lastIdx.current];
        for (let i = x; i <= y; i++) next.add(ids[i]);
      } else if (next.has(id)) next.delete(id); else next.add(id);
      lastIdx.current = idx;
      return next;
    });
  }, []);

  const allSel = visible.length > 0 && visible.every((a) => sel.has(a.id));
  const toggleAll = () => setSel(allSel ? new Set() : new Set(visible.map((a) => a.id)));
  const selCount = sel.size;
  const layout = g.kind === 'text' || (list.length && list.every((a) => a.kind === 'text')) ? 'text' : 'mixed';
  const total = list.length;
  // 96 px thumbnails when the group has art larger than 72 px, so 96×96 sprites show at 1× instead of shrinking
  const thumb = useMemo(() => (list.some((a) => Math.max(Number(a.meta.w) || 0, Number(a.meta.h) || 0) > 72) ? 96 : 72), [list]);
  const selectable = !readOnly;
  const titleEl = headerLink && mode !== 'page' ? html`<a href=${href.assets(g.id)} title="Open this group in Assets">${g.title}</a>` : g.title;

  return html`<section class=${cx('agroup', 'agroup-' + layout, mode === 'hub' && 'agroup-hub', mode === 'embed' && 'as-embed')} ref=${secRef} aria-label=${g.title} id=${'group-' + g.id} style=${{ '--thumb-col': (thumb + 4) + 'px' }}>
    <header class="agroup-head">
      <div class="agroup-row1">
        ${mode === 'page' ? null : html`<h3 class="agroup-title">${titleEl}</h3>`}
        <span class="agroup-total muted">${plural(total, 'asset')}${mode !== 'page' ? html` · <b>${fmtInt(liveCounts.approved)}</b> approved` : ''}</span>
        <span class="spacer"></span>
        <div class="agroup-actions">
          ${readOnly && html`<span class="badge badge-neutral as-ro-badge" title="You can look and comment, but not change review status"><${Icon} name="eye" size=${11} /> Read-only</span>`}
          <${BgToggle} project=${project} small />
        </div>
      </div>
      ${g.description && mode !== 'page' && html`<p class="agroup-desc">${g.description}</p>`}
      <${ProgressBar} counts=${liveCounts} label=${g.title} showLegend=${mode !== 'embed'} />
      ${mode !== 'hub' && html`<div class="agroup-filters">
        <${StatusChips} counts=${liveCounts} value=${status} onChange=${setStatusF} size="sm" />
        ${(qProp == null && (total > 6 || qLocal)) && html`<label class="search-mini">
          <${Icon} name="search" size=${13} />
          <input class="input input-sm" type="search" placeholder="Filter…" value=${qLocal} onInput=${(e) => setQLocal(e.currentTarget.value)} aria-label=${`Filter ${g.title}`} />
        </label>`}
      </div>`}
    </header>
    ${selCount > 0 && html`<${BulkBar} n=${selCount} allVisible=${filtered.length <= visible.length || selCount >= filtered.length}
      onSelectAll=${() => setSel(new Set(filtered.map((a) => a.id)))}
      onStatus=${async (s) => { const r = await bulkStatus(list.filter((a) => sel.has(a.id)), s); if (r) setSel(new Set()); }}
      onClear=${() => setSel(new Set())} />`}
    ${!total ? html`<${EmptyState} compact icon="image" title="No assets in this group yet">A developer adds them by running the asset refresh from the game's manifests.<//>`
      : !filtered.length ? html`<${EmptyState} compact icon="filter" title="Nothing matches">No ${status ? STATUS[status].label.toLowerCase() : ''} assets${q ? ` matching “${q}”` : ''} in this group. <button type="button" class="link-btn" onClick=${() => { setStatusF(''); setQLocal(''); }}>Clear filters</button><//>`
      : html`<div class="atable" role="table" aria-label=${`${g.title} assets`} aria-rowcount=${filtered.length + 1}>
          <div class="arow arow-head" role="row">
            <div class="ac ac-sel" role="columnheader">${selectable && html`<input type="checkbox" class="checkbox" checked=${allSel} aria-label="Select all visible" onClick=${toggleAll} />`}</div>
            <div class="ac ac-asset" role="columnheader">Asset</div>
            <div class="ac ac-cur" role="columnheader">Current</div>
            <div class="ac ac-shot" role="columnheader">In game</div>
            <div class="ac ac-repl" role="columnheader">Replacement</div>
            <div class="ac ac-status" role="columnheader">Status</div>
            <div class="ac ac-notes" role="columnheader">Notes</div>
            <div class="ac ac-upd" role="columnheader">Updated</div>
          </div>
          ${show ? visible.map((a) => html`<${AssetRow} key=${a.id} a=${a} selected=${sel.has(a.id)} onSelect=${onSelect} thumb=${thumb}
              readOnly=${readOnly} selectable=${selectable} threads=${openThreadCount(threads, a.id)} base=${base} />`)
            : html`<div class="arow-placeholder" style=${{ height: Math.min(visible.length, 12) * 97 + 'px' }}></div>`}
        </div>
        ${filtered.length > visible.length && html`<div class="agroup-more">
          <span class="muted">Showing ${fmtInt(visible.length)} of ${fmtInt(filtered.length)}</span>
          <${Btn} size="sm" onClick=${() => setLimit((l) => l + PAGE)}>Show ${fmtInt(Math.min(PAGE, filtered.length - visible.length))} more<//>
          ${filtered.length - visible.length > PAGE && html`<${Btn} size="sm" kind="ghost" onClick=${() => setLimit(filtered.length)}>Show all<//>`}
        </div>`}`}
    ${!readOnly && mode === 'page' && total > 0 && html`<p class="as-tip muted"><${Icon} name="info" size=${12} /> Drop a PNG on a row's Replacement cell, or focus it and press ${modKey}+V. Shift-click checkboxes to select a range.</p>`}
  </section>`;
}
