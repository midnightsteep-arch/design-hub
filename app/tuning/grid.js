// Spreadsheet grid (App.html §7): sticky header + key/name column, column-group band, type-aware cells,
// keyboard selection/editing, nudging, TSV paste, context menu, open-thread badges.
import { html, cx, plural, copyText } from '../lib.js';
import { useState, useRef, useEffect, useLayoutEffect } from '../../vendor/hooks.module.js';
import { Icon } from '../icons.js';
import { Menu, Popover, Portal, overlayOpen } from '../components/overlay.js';
import { toast } from '../components/toast.js';
import { useStore } from '../store.js';
import { useMediaQuery } from '../components/ui.js';
import { repoStore, schemaTable } from '../repo.js';
import { colEditable, parseInput, nudge, isNumType, displayText, editText } from '../canon.js';
import { stage, discard, undo, useEntries, useFlash, currentValue, openUi, openDrawer } from './staging.js';
import { cellId, lockReason, rangeText, typeText, defaultWidth, isRightAligned, lastNamePart, colOf } from './model.js';
import { countOf } from './model.js';
import { ValueView, ThreadBadge } from './cells.js';
import { CellInput, startEdit, toggleBool } from './editors.js';
import { useThreadIndex, openThreads, ThreadsPop } from './threads.js';
import { HistoryList } from './history.js';

const NAME = { id: '_name', type: 'name' };
const later = (fn) => setTimeout(fn, 0);
const esc = (s) => (window.CSS && CSS.escape ? CSS.escape(s) : String(s).replace(/["\\]/g, '\\$&'));

/** Parse TSV from spreadsheets (quoted cells may contain tabs/newlines). */
export function parseTSV(text) {
  const rows = []; let row = [], cell = '', q = false, i = 0;
  text = text.replace(/\r\n?/g, '\n');
  while (i < text.length) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i += 2; continue; } if (c === '"') { q = false; i++; continue; } cell += c; i++; continue; }
    if (c === '"' && cell === '') { q = true; i++; continue; }
    if (c === '\t') { row.push(cell); cell = ''; i++; continue; }
    if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; i++; continue; }
    cell += c; i++;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

function ColTip({ tip }) {
  const { col, rect, table } = tip;
  const left = Math.max(8, Math.min(rect.left, window.innerWidth - 328));
  const below = rect.bottom + 6;
  let body;
  if (col === NAME) body = html`<div class="tn-tip-t">${table.keyColumnLabel || 'Name'}</div><div class="tn-tip-x">Set by the engine. Click a name to open the row.</div>`;
  else {
    const meta = [typeText(col)];
    if (col.unit) meta.push('Unit: ' + col.unit);
    const rg = rangeText(col); if (rg) meta.push('Range ' + rg);
    const lk = lockReason(col); if (lk) meta.push(lk);
    body = html`<div class="tn-tip-t">${col.label || col.id}</div>${col.tooltip && html`<div class="tn-tip-x">${col.tooltip}</div>`}
      <div class="tn-tip-m">${meta.map((m) => html`<span>${m}</span>`)}</div>`;
  }
  return html`<${Portal}><div class="tn-tip" role="tooltip" style=${{ left: left + 'px', top: below + 'px' }}>${body}</div><//>`;
}

/**
 * Grid for one table. rows: filtered+sorted rows; groups: groupRows() result or null.
 * highlight: row key to select + flash. compact: embed mode.
 */
export function Grid(props) {
  return schemaTable(props.tid) ? html`<${GridInner} key=${props.tid} ...${props} />` : null;
}
function GridInner({ tid, rows, groups, density = 'compact', highlight, compact, emptyText }) {
  const t = schemaTable(tid);
  const canPush = useStore(repoStore, (s) => s.canPush);
  useStore(repoStore, (s) => s.version);
  const entries = useEntries();
  const flash = useFlash();
  const thr = useThreadIndex(tid);
  const [sel, setSel] = useState(null);       // {key, cid}
  const [edit, setEdit] = useState(null);     // {key, cid, initial}
  const [collapsed, setCollapsed] = useState(() => new Set());
  const [menu, setMenu] = useState(null);
  const [hist, setHist] = useState(null);
  const [tpop, setTpop] = useState(null);
  const [tip, setTip] = useState(null);
  const [hl, setHl] = useState(null);
  const scRef = useRef(null), headRef = useRef(null), tipTimer = useRef(0);
  const narrow = useMediaQuery('(max-width: 640px)');

  const cols = [NAME, ...t.columns];
  const nameW = narrow ? (t.parent ? 150 : 132) : compact ? (t.parent ? 190 : 170) : (t.parent ? 220 : 200);
  const widths = cols.map((c) => (c === NAME ? nameW : defaultWidth(c)));
  const totalW = widths.reduce((a, b) => a + b, 0);
  const hasBands = t.columns.some((c) => c.group);

  const items = [];
  if (groups) {
    for (const g of groups) {
      const closed = collapsed.has(g.key);
      items.push({ kind: 'grp', key: g.key, label: g.label, count: g.rows.length, closed, sec: !!g.sec, parentKey: g.parentKey });
      if (!closed) for (const r of g.rows) items.push({ kind: 'row', row: r });
    }
  } else for (const r of rows) items.push({ kind: 'row', row: r });
  const rowKeys = items.filter((x) => x.kind === 'row').map((x) => x.row.key);
  const rowByKey = new Map(rows.map((r) => [r.key, r]));

  const cellEl = (key, cid) => scRef.current && scRef.current.querySelector(`[data-k="${esc(key)}"][data-cid="${esc(cid)}"]`);
  const focusGrid = () => { if (scRef.current) scRef.current.focus({ preventScroll: true }); };

  // keep the selection visible inside the scroller (sticky header + name column aware)
  useLayoutEffect(() => {
    if (!sel || !scRef.current) return;
    const sc = scRef.current, el = cellEl(sel.key, sel.cid); if (!el) return;
    const headH = headRef.current ? headRef.current.offsetHeight : 0;
    const top = el.offsetTop, h = el.offsetHeight;
    if (top - headH < sc.scrollTop) sc.scrollTop = Math.max(0, top - headH);
    else if (top + h > sc.scrollTop + sc.clientHeight) sc.scrollTop = top + h - sc.clientHeight;
    if (sel.cid !== '_name') {
      const left = el.offsetLeft, w = el.offsetWidth;
      if (left < sc.scrollLeft + nameW) sc.scrollLeft = Math.max(0, left - nameW);
      else if (left + w > sc.scrollLeft + sc.clientWidth) sc.scrollLeft = left + w - sc.clientWidth;
    }
  }, [sel && sel.key, sel && sel.cid]);

  // highlight a row from the URL (?row=)
  useEffect(() => {
    if (!highlight || !rowByKey.has(highlight)) return;
    if (groups) {
      const g = groups.find((x) => x.rows.some((r) => r.key === highlight));
      if (g && collapsed.has(g.key)) setCollapsed((s) => { const n = new Set(s); n.delete(g.key); return n; });
    }
    setSel({ key: highlight, cid: '_name' }); setHl(highlight);
    requestAnimationFrame(() => { const el = cellEl(highlight, '_name'); if (el) el.scrollIntoView({ block: 'center', inline: 'nearest' }); });
    const tm = setTimeout(() => setHl(null), 2200);
    return () => clearTimeout(tm);
  }, [highlight, tid]);

  // copy / paste while the grid has focus
  useEffect(() => {
    const onCopy = (e) => {
      if (document.activeElement !== scRef.current || edit || !sel) return;
      const r = rowByKey.get(sel.key); if (!r) return;
      let v = sel.cid === '_name' ? r.name : currentValue(tid, sel.key, sel.cid);
      if (v == null) return;
      if (/[\t\n"]/.test(v)) v = '"' + v.replace(/"/g, '""') + '"';
      e.clipboardData.setData('text/plain', v); e.preventDefault();
      toast('Copied', { detail: sel.cid === '_name' ? r.name : displayText(colOf(tid, sel.cid), v, 50), duration: 1200 });
    };
    const onPaste = (e) => {
      if (document.activeElement !== scRef.current || edit || !sel) return;
      const text = e.clipboardData && e.clipboardData.getData('text/plain'); if (text == null) return;
      e.preventDefault(); pasteAt(text);
    };
    document.addEventListener('copy', onCopy); document.addEventListener('paste', onPaste);
    return () => { document.removeEventListener('copy', onCopy); document.removeEventListener('paste', onPaste); };
  });

  function pasteAt(text) {
    if (!canPush) { toast('You have read-only access', { detail: 'Use “Propose a change” to suggest new values.' }); return; }
    const c0 = cols.findIndex((c) => c.id === sel.cid), col0 = cols[c0];
    const matrix = col0 && col0.type === 'list' && !/^\s*\[/.test(text) && !text.includes('\t') ? [[text.replace(/\s+$/, '')]] : parseTSV(text);
    let ri = rowKeys.indexOf(sel.key); const changes = []; let ro = 0; const bad = [];
    for (let r = 0; r < matrix.length && ri >= 0 && ri < rowKeys.length; r++, ri++) {
      for (let c = 0; c < matrix[r].length; c++) {
        const col = cols[c0 + c]; if (!col) break;
        if (col === NAME || !colEditable(col)) { ro++; continue; }
        const p = parseInput(col, matrix[r][c]);
        if (!p.ok) { bad.push(`${col.label || col.id}: ${p.error}`); continue; }
        changes.push({ table: tid, key: rowKeys[ri], column: col.id, to: p.value });
      }
    }
    const n = stage(changes, { label: 'Paste' });
    const notes = [];
    if (ro) notes.push(plural(ro, 'locked cell') + ' skipped');
    if (bad.length) notes.push(plural(bad.length, 'invalid value') + ` skipped (${bad[0]})`);
    toast(n ? `Pasted ${plural(n, 'value')}` : 'Nothing pasted', { kind: bad.length ? 'error' : n ? 'success' : 'info', detail: notes.join(' · ') || undefined, action: n ? { label: 'Undo', icon: 'undo', run: undo } : null });
  }

  function move(dr, dc) {
    if (!rowKeys.length) return;
    if (!sel) { setSel({ key: rowKeys[0], cid: cols[1] ? cols[1].id : '_name' }); return; }
    let i = rowKeys.indexOf(sel.key); if (i < 0) i = 0;
    let ci = cols.findIndex((c) => c.id === sel.cid); if (ci < 0) ci = 0;
    i = Math.max(0, Math.min(rowKeys.length - 1, i + dr));
    ci = Math.max(0, Math.min(cols.length - 1, ci + dc));
    setSel({ key: rowKeys[i], cid: cols[ci].id });
  }
  function beginEdit(key, cid, initial) {
    if (cid === '_name') { openDrawer(tid, key); return; }
    const col = colOf(tid, cid); if (!col) return;
    if (!canPush && initial != null) return;
    const r = startEdit(tid, key, col, cellEl(key, cid), initial);
    if (r === 'inline') setEdit({ key, cid, initial });
  }
  function nudgeSel(dir, big) {
    if (!sel || !canPush) return;
    const col = colOf(tid, sel.cid);
    if (!col || !isNumType(col.type) || !colEditable(col)) return;
    stage([{ table: tid, key: sel.key, column: col.id, to: nudge(col, currentValue(tid, sel.key, col.id) || '0', dir, big) }], { label: col.label || col.id, coalesce: 'nudge:' + sel.key + col.id });
  }
  function openMenu(key, cid) { const el = cellEl(key, cid); if (el) setMenu({ anchor: el, key, cid }); }

  const onKey = (e) => {
    if (e.target !== scRef.current || overlayOpen()) return;
    const mod = e.ctrlKey || e.metaKey, k = e.key;
    if (mod && !/^Arrow|^Home$|^End$/.test(k)) return;
    const page = Math.max(1, Math.floor((scRef.current.clientHeight - 60) / 32) - 1);
    switch (k) {
      case 'ArrowDown': case 'ArrowUp':
        e.preventDefault();
        if (e.altKey) { nudgeSel(k === 'ArrowUp' ? 1 : -1, e.shiftKey); return; }
        move(k === 'ArrowDown' ? (mod ? 1e6 : 1) : (mod ? -1e6 : -1), 0); return;
      case 'ArrowRight': e.preventDefault(); move(0, mod ? 1e6 : 1); return;
      case 'ArrowLeft': e.preventDefault(); move(0, mod ? -1e6 : -1); return;
      case 'PageDown': e.preventDefault(); move(page, 0); return;
      case 'PageUp': e.preventDefault(); move(-page, 0); return;
      case 'Home': e.preventDefault(); if (mod) move(-1e6, -1e6); else move(0, -1e6); return;
      case 'End': e.preventDefault(); if (mod) move(1e6, 1e6); else move(0, 1e6); return;
      case 'Tab': {
        if (!sel) return;
        const ci = cols.findIndex((c) => c.id === sel.cid);
        if (!e.shiftKey && ci === cols.length - 1) { const i = rowKeys.indexOf(sel.key); if (i < rowKeys.length - 1) { e.preventDefault(); setSel({ key: rowKeys[i + 1], cid: cols[1] ? cols[1].id : '_name' }); } return; }
        if (e.shiftKey && ci === 0) { const i = rowKeys.indexOf(sel.key); if (i > 0) { e.preventDefault(); setSel({ key: rowKeys[i - 1], cid: cols[cols.length - 1].id }); } return; }
        e.preventDefault(); move(0, e.shiftKey ? -1 : 1); return;
      }
      case 'Enter': case 'F2':
        e.preventDefault();
        if (!sel) { move(0, 0); return; }
        if (e.shiftKey || sel.cid === '_name') { openDrawer(tid, sel.key, sel.cid === '_name' ? null : sel.cid); return; }
        beginEdit(sel.key, sel.cid); return;
      case ' ': {
        e.preventDefault(); if (!sel) return;
        if (sel.cid === '_name') { openDrawer(tid, sel.key); return; }
        beginEdit(sel.key, sel.cid); return;
      }
      case 'Delete': case 'Backspace': {
        e.preventDefault(); if (!sel || sel.cid === '_name') return;
        const id = cellId(tid, sel.key, sel.cid), col = colOf(tid, sel.cid);
        if (entries[id]) { discard([id], 'Discard ' + (col.label || col.id)); toast('Back to the saved value', { detail: col.label || col.id, action: { label: 'Undo', icon: 'undo', run: undo }, duration: 2400 }); }
        else if (canPush && colEditable(col) && (col.type === 'string' || isNumType(col.type))) setEdit({ key: sel.key, cid: sel.cid, initial: '' });
        return;
      }
      case 'ContextMenu': e.preventDefault(); if (sel) openMenu(sel.key, sel.cid); return;
      case 'F10': if (e.shiftKey) { e.preventDefault(); if (sel) openMenu(sel.key, sel.cid); } return;
      case 'Escape': if (sel && !edit) { /* let overlays handle Esc first */ } return;
    }
    if (k.length === 1 && !e.altKey && !mod && sel && sel.cid !== '_name' && canPush) {
      const col = colOf(tid, sel.cid);
      if (!col || !colEditable(col) || ['bool', 'list', 'flags', 'color'].includes(col.type)) return;
      e.preventDefault(); beginEdit(sel.key, sel.cid, k);
    }
  };

  const cellAt = (e) => e.target.closest && e.target.closest('[data-cid][data-k]');
  const wasSel = useRef(false), handled = useRef(false);
  const onMouseDown = (e) => {
    if (e.button !== 0) return;
    const c = cellAt(e); if (!c || e.target.closest('.tn-edit')) return;
    const key = c.getAttribute('data-k'), cid = c.getAttribute('data-cid');
    wasSel.current = !!sel && sel.key === key && sel.cid === cid;
    handled.current = false;
    if (edit && (edit.key !== key || edit.cid !== cid)) { /* the open input commits on blur */ }
    setSel({ key, cid });
    const x = e.target.closest('[data-x]'), kind = x && x.getAttribute('data-x');
    const col = cid === '_name' ? null : colOf(tid, cid);
    if (col && canPush && colEditable(col)) {
      if (kind === 'bool') { e.preventDefault(); handled.current = true; toggleBool(tid, key, col); focusGrid(); return; }
      if (kind === 'enum' || kind === 'flags') { e.preventDefault(); handled.current = true; focusGrid(); requestAnimationFrame(() => beginEdit(key, cid)); return; }
    }
  };
  const onClick = (e) => {
    const c = cellAt(e); if (!c || handled.current || e.target.closest('.tn-edit')) return;
    if (wasSel.current && c.getAttribute('data-cid') !== '_name') beginEdit(c.getAttribute('data-k'), c.getAttribute('data-cid'));
  };
  const onDbl = (e) => {
    const c = cellAt(e); if (!c || e.target.closest('.tn-edit') || handled.current) return;
    if (c.getAttribute('data-cid') === '_name') openDrawer(tid, c.getAttribute('data-k'));
    else if (!edit) beginEdit(c.getAttribute('data-k'), c.getAttribute('data-cid'));
  };
  const onCtx = (e) => {
    const c = cellAt(e); if (!c) return;
    e.preventDefault();
    const key = c.getAttribute('data-k'), cid = c.getAttribute('data-cid');
    setSel({ key, cid }); setMenu({ anchor: c, key, cid });
  };
  const doneEdit = (res, dir) => {
    setEdit(null); focusGrid();
    if (res === 'commit' && dir) move(dir === 'down' ? 1 : dir === 'up' ? -1 : 0, dir === 'right' ? 1 : dir === 'left' ? -1 : 0);
  };
  const showTip = (col, e) => { clearTimeout(tipTimer.current); const r = e.currentTarget.getBoundingClientRect(); tipTimer.current = setTimeout(() => setTip({ col, rect: r, table: t }), 380); };
  const hideTip = () => { clearTimeout(tipTimer.current); setTip(null); };

  // ---------- menu
  let menuItems = null;
  if (menu) {
    const { key, cid } = menu, col = cid === '_name' ? null : colOf(tid, cid), id = cellId(tid, key, cid);
    const ed = col && canPush && colEditable(col);
    menuItems = [
      col && ed && { label: 'Edit value', icon: 'edit', hint: 'Enter', onSelect: () => later(() => beginEdit(key, cid)) },
      col && isNumType(col.type) && ed && { label: 'Nudge up', icon: 'chevron-up', hint: 'Alt+↑', onSelect: () => stage([{ table: tid, key, column: cid, to: nudge(col, currentValue(tid, key, cid) || '0', 1) }], { label: col.label }) },
      col && isNumType(col.type) && ed && { label: 'Nudge down', icon: 'chevron-down', hint: 'Alt+↓', onSelect: () => stage([{ table: tid, key, column: cid, to: nudge(col, currentValue(tid, key, cid) || '0', -1) }], { label: col.label }) },
      col && entries[id] && { label: 'Discard my change', icon: 'undo', onSelect: () => discard([id], 'Discard ' + (col.label || col.id)) },
      col && { separator: true },
      col && colEditable(col) && { label: 'Propose a change…', icon: 'swap', onSelect: () => later(() => openUi({ kind: 'propose', tid, key, cid })) },
      { label: 'Comment on this row…', icon: 'comment', onSelect: () => later(() => openUi({ kind: 'comment', tid, key })) },
      col && { label: 'History of this value', icon: 'history', onSelect: () => later(() => setHist({ anchor: cellEl(key, cid), key, cid })) },
      { separator: true },
      { label: 'Open row details', icon: 'sidebar', hint: 'Shift+Enter', onSelect: () => later(() => openDrawer(tid, key, col ? cid : null)) },
      { label: 'Copy value', icon: 'copy', onSelect: () => { const r = rowByKey.get(key); const v = col ? currentValue(tid, key, cid) : r && r.name; copyText(v == null ? '' : String(v)).then((ok) => toast(ok ? 'Copied' : "Couldn't copy", { duration: 1200 })); } },
    ].filter(Boolean);
    while (menuItems.length && menuItems[0].separator) menuItems.shift();
  }

  // ---------- render
  const band = hasBands && (() => {
    const out = [html`<div class="tn-bcell tn-sticky" style=${{ width: nameW + 'px' }}></div>`];
    let i = 1;
    while (i < cols.length) {
      const g = cols[i].group || null; let w = 0, j = i;
      while (j < cols.length && (cols[j].group || null) === g) { w += widths[j]; j++; }
      out.push(html`<div class=${cx('tn-bcell', g && 'is-named')} style=${{ width: w + 'px' }}>${g && html`<span>${g}</span>`}</div>`);
      i = j;
    }
    return html`<div class="tn-band" role="presentation">${out}</div>`;
  })();
  const head = html`<div class="tn-hrow" role="row">${cols.map((c, ci) => {
    const lk = c !== NAME && !colEditable(c);
    return html`<div role="columnheader" class=${cx('tn-hcell', ci === 0 && 'tn-sticky', c !== NAME && isRightAligned(c) && 'is-r', sel && sel.cid === c.id && 'is-selcol')}
      style=${{ width: widths[ci] + 'px' }} onMouseEnter=${(e) => showTip(c, e)} onMouseLeave=${hideTip} aria-label=${c === NAME ? t.keyColumnLabel || 'Name' : `${c.label || c.id}${c.unit ? ' (' + c.unit + ')' : ''}${lk ? ', ' + lockReason(c) : ''}`}>
      ${lk && html`<${Icon} name="lock" size=${11} class="tn-lk" />`}<span class="tn-ht">${c === NAME ? t.keyColumnLabel || 'Name' : c.label || c.id}</span>${c.unit && html`<span class="tn-u">${c.unit}</span>`}
    </div>`;
  })}</div>`;

  const body = items.map((it, ii) => {
    if (it.kind === 'grp') {
      return html`<div key=${'g' + it.key} class=${cx('tn-row tn-grp', it.closed && 'is-closed', it.sec && 'is-sec')} role="row" style=${{ width: totalW + 'px' }}>
        <button type="button" class="tn-cell tn-name tn-sticky tn-grp-btn" style=${{ width: nameW + 'px' }} aria-expanded=${String(!it.closed)}
          onClick=${() => setCollapsed((s) => { const n = new Set(s); if (n.has(it.key)) n.delete(it.key); else n.add(it.key); return n; })}>
          <${Icon} name="chevron-down" size=${13} class="tn-chev" /><span class="tn-nm">${it.label}</span><span class="tn-gcount">${it.count}</span></button>
        <div class="tn-cell tn-grp-fill" style=${{ width: (totalW - nameW) + 'px' }}></div>
      </div>`;
    }
    const r = it.row, rowThreads = thr.row.get(r.key) || [];
    const rowDirty = Object.values(entries).some((e) => e.table === tid && e.key === r.key);
    return html`<div key=${r.key} class=${cx('tn-row', hl === r.key && 'is-hl')} role="row" style=${{ width: totalW + 'px' }}>
      ${cols.map((c, ci) => {
        const isSel = sel && sel.key === r.key && sel.cid === c.id;
        if (c === NAME) {
          return html`<div role="rowheader" class=${cx('tn-cell tn-name tn-sticky', t.parent && 'is-child', isSel && 'is-sel')} style=${{ width: nameW + 'px' }} data-k=${r.key} data-cid="_name" title=${r.name}>
            ${rowDirty && html`<span class="tn-sdot" title="Has unsaved changes"></span>`}
            <button type="button" class="tn-nm-btn" tabindex="-1" onClick=${(e) => { e.stopPropagation(); openDrawer(tid, r.key); }}>${t.parent ? lastNamePart(r.name) : r.name}</button>
            <${ThreadBadge} n=${rowThreads.length} onClick=${(e) => openThreads(rowThreads, e.currentTarget, setTpop)} />
          </div>`;
        }
        const id = cellId(tid, r.key, c.id), e = entries[id], cv = e ? e.to : currentValue(tid, r.key, c.id);
        const ed = colEditable(c), editing = edit && edit.key === r.key && edit.cid === c.id;
        const ct = thr.cell.get(r.key + '\u0001' + c.id) || [];
        const title = e ? (e.conflict ? `Someone changed this to ${displayText(c, e.conflict.current)} after you edited it. Review to resolve.` : `Changed · was ${displayText(c, e.from, 80)}`) : !ed ? lockReason(c) : undefined;
        const fl = flash[id] && flash[id] > Date.now();
        return html`<div role="gridcell" aria-selected=${String(!!isSel)} aria-readonly=${String(!ed || !canPush)}
          class=${cx('tn-cell', isRightAligned(c) && 'is-r', !ed && 'is-ro', isSel && 'is-sel', e && (e.conflict ? 'is-staged is-conflict' : 'is-staged'), editing && 'is-editing', fl && 'is-flash')}
          style=${{ width: widths[ci] + 'px' }} data-k=${r.key} data-cid=${c.id} title=${editing ? undefined : title}>
          ${editing ? html`<${CellInput} tid=${tid} rowKey=${r.key} col=${c} initial=${edit.initial} onDone=${doneEdit} />`
            : html`<${ValueView} col=${c} cv=${cv} editable=${ed && canPush} />`}
          ${!ed && !editing && html`<${Icon} name="lock" size=${11} class="tn-lkh" />`}
          ${isSel && !editing && ed && canPush && isNumType(c.type) && html`<span class="tn-nudge" onMouseDown=${(ev) => { ev.stopPropagation(); ev.preventDefault(); }}>
            <button type="button" tabindex="-1" aria-label="Nudge up" onClick=${(ev) => { ev.stopPropagation(); nudgeSel(1, ev.shiftKey); }}><${Icon} name="chevron-up" size=${11} /></button>
            <button type="button" tabindex="-1" aria-label="Nudge down" onClick=${(ev) => { ev.stopPropagation(); nudgeSel(-1, ev.shiftKey); }}><${Icon} name="chevron-down" size=${11} /></button></span>`}
          <${ThreadBadge} n=${ct.length} onClick=${(ev) => openThreads(ct, ev.currentTarget, setTpop)} />
        </div>`;
      })}
    </div>`;
  });

  const selCol = sel && sel.cid !== '_name' ? colOf(tid, sel.cid) : null;
  return html`<div class=${cx('tn-grid', 'tn-d-' + density, compact && 'is-compact')}>
    <div class="tn-gscroll" ref=${scRef} tabindex="0" role="grid" aria-label=${`${t.label || t.id} table`} aria-rowcount=${rowKeys.length + 1} aria-colcount=${cols.length}
      onKeyDown=${onKey} onMouseDown=${onMouseDown} onClick=${onClick} onDblClick=${onDbl} onContextMenu=${onCtx}
      onFocus=${(e) => { if (e.target === scRef.current && rowKeys.length) setSel((s) => s || { key: rowKeys[0], cid: cols[1] ? cols[1].id : '_name' }); }}>
      <div class="tn-ginner" style=${{ width: totalW + 'px' }}>
        <div class="tn-ghead" ref=${headRef}>${band}${head}</div>
        <div class="tn-gbody">${items.length ? body : html`<div class="tn-gempty" style=${{ width: 'min(100%, 100vw - 48px)' }}>${emptyText || 'No rows match.'}</div>`}</div>
      </div>
    </div>
    <div class="tn-gstatus muted" aria-live="polite">
      ${sel ? html`<span><b>${(rowByKey.get(sel.key) || {}).name || ''}</b>${selCol ? ' · ' + (selCol.label || selCol.id) : ''}</span>
        ${selCol && !colEditable(selCol) && html`<span class="tn-gs-lock"><${Icon} name="lock" size=${11} /> ${lockReason(selCol)}</span>`}
        <span class="grow"></span>
        <span class="tn-gs-keys">${canPush ? 'Enter edit · Alt+↑↓ nudge · Shift+F10 menu' : 'Read-only · Enter to propose a change'}</span>`
        : html`<span>${countOf(rowKeys.length, t.rowLabel)}</span><span class="grow"></span><span class="tn-gs-keys">Click a cell, then type to edit${canPush ? '' : ' (read-only: you can propose changes)'}</span>`}
    </div>
    ${tip && html`<${ColTip} tip=${tip} />`}
    ${menu && html`<${Menu} anchor=${menu.anchor} onClose=${() => { setMenu(null); }} items=${menuItems} label="Cell actions" />`}
    ${tpop && html`<${ThreadsPop} pop=${tpop} onClose=${() => setTpop(null)} />`}
    ${hist && html`<${Popover} anchor=${hist.anchor} onClose=${() => { setHist(null); focusGrid(); }} label="History" width=${340} class="tn-pop tn-hist-pop">
      <div class="tn-pop-pad"><div class="tn-pop-title">${(colOf(tid, hist.cid) || {}).label || hist.cid} · ${(rowByKey.get(hist.key) || {}).name || ''}</div>
        <${HistoryList} tid=${tid} rowKey=${hist.key} column=${hist.cid} limit=${10} /></div><//>`}
  </div>`;
}
