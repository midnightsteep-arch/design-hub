// Rich cards view (Tuning Desk §10, App.html Cards): title / description / badges / footer per table.card,
// other columns as panels grouped by column group (ungrouped → "Details"), inline editing, live previews.
import { html, cx } from '../lib.js';
import { useState, useEffect, useRef } from '../../vendor/hooks.module.js';
import { Icon } from '../icons.js';
import { useStore } from '../store.js';
import { repoStore, schemaTable } from '../repo.js';
import { colEditable, isNumType, displayText } from '../canon.js';
import { useEntries, currentValue, openUi, openDrawer } from './staging.js';
import { cellId, cardLayout, lockReason, lastNamePart, colOf } from './model.js';
import { ValueView, ThreadBadge, numText } from './cells.js';
import { CellInput, startEdit, toggleBool, editorKind } from './editors.js';
import { PreviewBlock } from './preview.js';
import { useThreadIndex, openThreads, ThreadsPop } from './threads.js';

function stagedCls(e) { return e ? (e.conflict ? 'is-staged is-conflict' : 'is-staged') : ''; }
function stagedTip(col, e) {
  if (!e) return undefined;
  return e.conflict ? `Someone changed this to ${displayText(col, e.conflict.current)} after you edited it. Review to resolve.` : `Changed · was ${displayText(col, e.from, 60)}`;
}

function CardField({ tid, rowKey, col, e, canPush, threads, setTpop }) {
  const [editing, setEditing] = useState(false);
  const ref = useRef(null);
  const ed = colEditable(col);
  const cv = e ? e.to : currentValue(tid, rowKey, col.id);
  const go = () => {
    if (editing) return;
    if (!canPush) { openUi({ kind: 'propose', tid, key: rowKey, cid: col.id }); return; }
    if (startEdit(tid, rowKey, col, ref.current) === 'inline') setEditing(true);
  };
  return html`<div class=${cx('tn-rf', !ed && 'is-ro', stagedCls(e))} title=${stagedTip(col, e) || (!ed ? lockReason(col) : undefined)}>
    <span class="tn-rf-k" title=${col.tooltip}>${col.label || col.id}${!ed && html`<${Icon} name="lock" size=${11} />`}${col.computed && html`<i class="tn-fx" title="Computed by the engine">ƒ</i>`}</span>
    ${editing ? html`<span class="tn-rf-v is-editing"><${CellInput} tid=${tid} rowKey=${rowKey} col=${col} class="tn-edit-card" onDone=${() => { setEditing(false); requestAnimationFrame(() => ref.current && ref.current.focus()); }} /></span>`
      : html`<span class="tn-rf-v" ref=${ref} role=${ed || !canPush ? 'button' : undefined} tabindex=${ed ? 0 : undefined}
          aria-label=${`${col.label || col.id}: ${displayText(col, cv)}${ed ? (canPush ? ', press Enter to edit' : ', press Enter to propose a change') : ''}`}
          onClick=${ed ? go : undefined} onKeyDown=${(ev) => { if (ed && (ev.key === 'Enter' || ev.key === ' ' || ev.key === 'F2')) { ev.preventDefault(); go(); } }}>
          <${ValueView} col=${col} cv=${cv} editable=${false} /></span>`}
    <${ThreadBadge} n=${threads.length} onClick=${(ev) => openThreads(threads, ev.currentTarget, setTpop)} />
  </div>`;
}

function Badge({ tid, rowKey, col, e, canPush }) {
  const ref = useRef(null);
  const v = e ? e.to : currentValue(tid, rowKey, col.id), ed = colEditable(col);
  let inner;
  if (col.type === 'enum') inner = v ? v : html`<span class="tn-bl">${col.label}</span> —`;
  else if (col.type === 'bool') inner = html`<span class="tn-bl">${col.label}</span> <b>${v === 'true' ? 'On' : 'Off'}</b>`;
  else if (isNumType(col.type)) inner = html`<span class="tn-bl">${col.label}</span> <b>${v == null ? '?' : numText(v)}</b>${col.unit && html`<span class="tn-bl">${col.unit}</span>`}`;
  else inner = html`<span class="tn-bl">${col.label}</span> <b>${displayText(col, v, 24)}</b>`;
  const go = () => {
    if (!canPush) { openUi({ kind: 'propose', tid, key: rowKey, cid: col.id }); return; }
    if (!ed) return;
    const k = editorKind(col, v);
    if (k === 'bool') { toggleBool(tid, rowKey, col); return; }
    if (k === 'inline') { openUi({ kind: 'value', tid, key: rowKey, cid: col.id, anchor: ref.current }); return; }
    startEdit(tid, rowKey, col, ref.current);
  };
  return html`<button type="button" ref=${ref} class=${cx('tn-badge', col.type === 'enum' && 'is-en', !ed && 'is-ro', stagedCls(e))} disabled=${!ed && canPush}
    title=${stagedTip(col, e) || (col.label + (col.tooltip ? ' · ' + col.tooltip : '') + (!ed ? ' · ' + lockReason(col) : ''))} onClick=${go}>${inner}</button>`;
}

function Card({ tid, row, L, entries, canPush, thr, setTpop, hl }) {
  const t = schemaTable(tid), key = row.key;
  const [descEdit, setDescEdit] = useState(false);
  const descRef = useRef(null);
  const ents = Object.values(entries).filter((x) => x.table === tid && x.key === key);
  const dirty = ents.length > 0, conflict = ents.some((x) => x.conflict);
  const E = (cid) => entries[cellId(tid, key, cid)] || null;
  const cur = (cid) => currentValue(tid, key, cid);
  const tc = L.title && colOf(tid, L.title);
  const titleTxt = tc ? cur(tc.id) || '' : (t.parent ? lastNamePart(row.name) : row.name);
  const rowThreads = thr.all.get(key) || [];
  const dc = L.desc && colOf(tid, L.desc), dv = dc ? cur(dc.id) || '' : '', ded = dc && colEditable(dc);
  const startDesc = () => {
    if (!dc) return;
    if (!canPush) { openUi({ kind: 'propose', tid, key, cid: dc.id }); return; }
    if (ded) setDescEdit(true);
  };
  return html`<article class=${cx('tn-rc', dirty && 'is-dirty', conflict && 'is-conflict', hl && 'is-hl')} data-rk=${key} aria-label=${row.name}>
    <header class="tn-rc-h">
      <div class="tn-rc-top">
        ${dirty && html`<span class="tn-sdot" title="Has unsaved changes"></span>`}
        <h3 class="tn-rc-title"><button type="button" class=${cx('tn-rc-tbtn', tc && E(tc.id) && 'is-staged', !titleTxt && 'is-empty')} onClick=${() => openDrawer(tid, key)} title=${`Open ${row.name}`}>${titleTxt || 'Untitled'}</button></h3>
        <span class="tn-rc-acts">
          <${ThreadBadge} n=${rowThreads.length} onClick=${(ev) => openThreads(rowThreads, ev.currentTarget, setTpop)} />
          <button type="button" class="icon-btn icon-btn-sm" title="Comment on this row" aria-label="Comment on this row" onClick=${() => openUi({ kind: 'comment', tid, key })}><${Icon} name="comment" size=${15} /></button>
          <button type="button" class="icon-btn icon-btn-sm" title="Open details and history" aria-label="Open details and history" onClick=${() => openDrawer(tid, key)}><${Icon} name="sidebar" size=${15} /></button>
        </span>
      </div>
      ${L.badges.length > 0 && html`<div class="tn-rc-badges">${L.badges.map((cid) => html`<${Badge} key=${cid} tid=${tid} rowKey=${key} col=${colOf(tid, cid)} e=${E(cid)} canPush=${canPush} />`)}</div>`}
    </header>
    ${dc && (descEdit ? html`<div class="tn-rc-desc is-editing"><${CellInput} tid=${tid} rowKey=${key} col=${dc} multi=${true} autoSelect=${false} class="tn-edit-desc"
          onDone=${() => { setDescEdit(false); requestAnimationFrame(() => descRef.current && descRef.current.focus()); }} />
        <div class="tn-hint muted">${navigator.platform && /Mac/.test(navigator.platform) ? '⌘' : 'Ctrl'}+Enter to apply · Esc to cancel</div></div>`
      : html`<div ref=${descRef} class=${cx('tn-rc-desc', !dv && 'is-empty', stagedCls(E(dc.id)), ded && 'is-ed')} title=${stagedTip(dc, E(dc.id))}
          role=${ded || !canPush ? 'button' : undefined} tabindex=${ded ? 0 : undefined} onClick=${startDesc}
          onKeyDown=${(ev) => { if (ev.key === 'Enter' || ev.key === 'F2') { ev.preventDefault(); startDesc(); } }}>${dv || (ded && canPush ? 'Add a description…' : 'No description')}</div>`)}
    ${L.panels.length > 0 && html`<div class="tn-rc-panels">${L.panels.map((p) => html`<section class="tn-rc-panel" key=${p.name}>
      <div class="tn-rc-ph">${p.name}</div>
      ${p.cols.map((c) => html`<${CardField} key=${c.id} tid=${tid} rowKey=${key} col=${c} e=${E(c.id)} canPush=${canPush} threads=${thr.cell.get(key + '\u0001' + c.id) || []} setTpop=${setTpop} />`)}
      ${p.previews.map((pv) => html`<div class="tn-pv-wrap" key=${'pv' + pv.id}><${PreviewBlock} tid=${tid} rowKey=${key} pv=${pv} compact=${true} current=${currentValue} /></div>`)}
    </section>`)}</div>`}
    ${L.footer.length > 0 && html`<footer class="tn-rc-foot">${L.footer.map((cid) => { const c = colOf(tid, cid); return html`<span key=${cid}>${c.label || c.id} <b>${displayText(c, cur(cid), 40)}</b>${c.computed && html`<i class="tn-fx" title="Computed by the engine">ƒ</i>`}</span>`; })}</footer>`}
  </article>`;
}

export function Cards({ tid, rows, groups, highlight, emptyText }) {
  const t = schemaTable(tid);
  const canPush = useStore(repoStore, (s) => s.canPush);
  useStore(repoStore, (s) => s.version);
  const entries = useEntries();
  const thr = useThreadIndex(tid);
  const [tpop, setTpop] = useState(null);
  const [hl, setHl] = useState(null);
  const hostRef = useRef(null);
  useEffect(() => {
    if (!highlight) return undefined;
    setHl(highlight);
    requestAnimationFrame(() => { const el = hostRef.current && hostRef.current.querySelector(`[data-rk="${CSS.escape(highlight)}"]`); if (el) el.scrollIntoView({ block: 'center' }); });
    const tm = setTimeout(() => setHl(null), 2200);
    return () => clearTimeout(tm);
  }, [highlight, tid]);
  if (!t) return null;
  const L = cardLayout(t);
  const card = (r) => html`<${Card} key=${r.key} tid=${tid} row=${r} L=${L} entries=${entries} canPush=${canPush} thr=${thr} setTpop=${setTpop} hl=${hl === r.key} />`;
  if (!rows.length) return html`<div class="tn-cards-empty muted">${emptyText || 'No rows match.'}</div>`;
  return html`<div class="tn-cards" ref=${hostRef}>
    ${groups ? groups.map((g) => html`<div class="tn-rc-sec" key=${'s' + g.key}><${Icon} name=${g.sec ? 'filter' : 'chevron-right'} size=${13} /><span>${g.label}</span><span class="tn-gcount">${g.rows.length}</span></div>
      <div class="tn-rc-grid">${g.rows.map(card)}</div>`)
      : html`<div class="tn-rc-grid">${rows.map(card)}</div>`}
    ${tpop && html`<${ThreadsPop} pop=${tpop} onClose=${() => setTpop(null)} />`}
  </div>`;
}
