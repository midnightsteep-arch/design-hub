// Row drawer (App.html §11): every field editable, previews, child rows, discussions, propose/comment, history.
import { html, cx, plural } from '../lib.js';
import { useState, useRef, useEffect } from '../../vendor/hooks.module.js';
import { Icon } from '../icons.js';
import { Drawer } from '../components/overlay.js';
import { useStore } from '../store.js';
import { repoStore, schemaTable, tableRows, cellValue } from '../repo.js';
import { discussStore, threadsFor } from '../discuss.js';
import { href, navigate, useRoute } from '../router.js';
import { colEditable, isNumType, parseInput, nudge, editText, canon, canonColor, listItems, parseItems, fmtPlain, displayText, vecLen } from '../canon.js';
import { stage, discard, useEntries, currentValue, openUi, openDrawer } from './staging.js';
import { cellId, lockReason, rangeText, childTablesOf, parentKeyOf, lastNamePart, tableLabel, sortedRows, rowOf, colOf, nounPlural } from './model.js';
import { ValueView, Spark } from './cells.js';
import { PreviewBlock } from './preview.js';
import { HistoryList } from './history.js';

function DrawerField({ tid, rowKey, col, e, canPush }) {
  const ed = colEditable(col) && canPush;
  const cv = e ? e.to : currentValue(tid, rowKey, col.id);
  const [draft, setDraft] = useState(null);
  const [err, setErr] = useState('');
  const [showHist, setShowHist] = useState(false);
  const num = isNumType(col.type);
  useEffect(() => { setDraft(null); setErr(''); }, [cv]);
  const put = (to, coalesce) => stage([{ table: tid, key: rowKey, column: col.id, to }], { label: col.label || col.id, coalesce });
  const commitText = (text) => {
    const r = parseInput(col, text);
    if (!r.ok) { setErr(r.error + ' — not changed'); return; }
    setErr(''); setDraft(null); put(r.value);
  };
  const id = 'tn-f-' + col.id.replace(/[^\w-]/g, '_');
  let ctl;
  if (!colEditable(col) || !canPush) ctl = html`<div class="tn-f-ro"><${ValueView} col=${col} cv=${cv} editable=${false} /></div>`;
  else switch (col.type) {
    case 'int': case 'float': {
      const val = draft != null ? draft : cv;
      const bump = (d, big) => { const r = parseInput(col, val); put(nudge(col, r.ok ? r.value : cv || '0', d, big), 'nudge:' + tid + rowKey + col.id); };
      ctl = html`<div class="tn-f-row">
        <button type="button" class="icon-btn icon-btn-sm tn-f-nb" aria-label=${`Decrease ${col.label}`} onClick=${(ev) => bump(-1, ev.shiftKey)}><${Icon} name="minus" size=${14} /></button>
        <input id=${id} class=${cx('input input-sm tn-num', err && 'is-invalid')} value=${val} spellcheck=${false} inputmode="decimal"
          onInput=${(ev) => { setDraft(ev.currentTarget.value); const r = parseInput(col, ev.currentTarget.value); setErr(r.ok ? '' : r.error); }}
          onChange=${(ev) => commitText(ev.currentTarget.value)}
          onKeyDown=${(ev) => {
            if (ev.key === 'Enter') { ev.preventDefault(); commitText(ev.currentTarget.value); }
            if (ev.key === 'ArrowUp' || ev.key === 'ArrowDown') { ev.preventDefault(); bump(ev.key === 'ArrowUp' ? 1 : -1, ev.shiftKey); }
            if (ev.key === 'Escape' && draft != null) { ev.preventDefault(); ev.stopPropagation(); setDraft(null); setErr(''); }
          }} />
        <button type="button" class="icon-btn icon-btn-sm tn-f-nb" aria-label=${`Increase ${col.label}`} onClick=${(ev) => bump(1, ev.shiftKey)}><${Icon} name="plus" size=${14} /></button>
        ${col.min != null && col.max != null && html`<input type="range" class="tn-f-range" aria-label=${`${col.label} slider`} min=${col.min} max=${col.max}
          step=${col.step || (col.type === 'int' ? 1 : (col.max - col.min) / 200)} value=${Number(cv) || 0}
          onInput=${(ev) => { const v = Number(ev.currentTarget.value); const c = canon(col, col.type === 'int' ? Math.round(v) : +v.toPrecision(6)); if (c != null) put(c, 'range:' + tid + rowKey + col.id); }} />`}
      </div>`;
      break;
    }
    case 'bool':
      ctl = html`<button type="button" id=${id} role="switch" aria-checked=${String(cv === 'true')} class=${cx('tn-switch tn-switch-btn', cv === 'true' && 'is-on')}
        onClick=${() => put(cv === 'true' ? 'false' : 'true')}><span class="sr-only">${col.label}</span></button>`;
      break;
    case 'enum': {
      const opts = col.options || [];
      ctl = opts.length <= 4
        ? html`<div class="segmented tn-f-seg" role="radiogroup" aria-label=${col.label}>${opts.map((o) => html`<button type="button" role="radio" aria-checked=${String(o === cv)} class=${cx('seg-opt', o === cv && 'is-active')} onClick=${() => put(o)}>${o}</button>`)}</div>`
        : html`<select id=${id} class="input select input-sm" value=${cv} onChange=${(ev) => put(ev.currentTarget.value)}>${cv === '' && html`<option value="">—</option>`}${opts.map((o) => html`<option value=${o}>${o}</option>`)}</select>`;
      break;
    }
    case 'flags': {
      const on = (cv || '').split('|').filter(Boolean);
      ctl = html`<div class="tn-f-flags" role="group" aria-label=${col.label}>${(col.options || []).map((o) => html`<button type="button" aria-pressed=${String(on.includes(o))} class=${cx('chip', on.includes(o) && 'is-active')}
        onClick=${() => put(canon(col, (on.includes(o) ? on.filter((x) => x !== o) : [...on, o]).join('|')))}>${on.includes(o) && html`<${Icon} name="check" size=${12} />`}${o}</button>`)}</div>`;
      break;
    }
    case 'color': {
      const hex = draft != null ? draft : cv;
      ctl = html`<div class="tn-f-row"><input type="color" class="tn-color-in" aria-label=${`${col.label} picker`} value=${(cv || '#FFFFFF').slice(0, 7).toLowerCase()}
          onInput=${(ev) => put(ev.currentTarget.value.toUpperCase() + (cv || '#FFFFFFFF').slice(7, 9), 'color:' + tid + rowKey + col.id)} />
        <input id=${id} class=${cx('input input-sm tn-mono', err && 'is-invalid')} value=${hex} spellcheck=${false}
          onInput=${(ev) => { setDraft(ev.currentTarget.value); setErr(canonColor(ev.currentTarget.value) ? '' : 'Use #RRGGBB or #RRGGBBAA'); }}
          onChange=${(ev) => { const c = canonColor(ev.currentTarget.value); if (c) { setDraft(null); put(c); } }} /></div>`;
      break;
    }
    case 'vector2': case 'vector3': case 'vector4': {
      const vs = (listItems(cv) || []).map((x) => fmtPlain(x));
      const vals = draft || vs;
      ctl = html`<div class="tn-f-vec" style=${{ gridTemplateColumns: `repeat(${vecLen(col.type)}, minmax(0, 1fr))` }}>${vals.map((v, i) => html`<label><span>${'XYZW'[i]}</span>
        <input class="input input-sm tn-num" value=${v} spellcheck=${false} aria-label=${`${col.label} ${'XYZW'[i]}`}
          onInput=${(ev) => { const nv = vals.slice(); nv[i] = ev.currentTarget.value; setDraft(nv); }}
          onChange=${() => { const pr = parseItems(col, draft || vals); if (!pr.ok) { setErr(pr.error + ' — not changed'); return; } setErr(''); setDraft(null); put(pr.value); }}
          onKeyDown=${(ev) => { if (ev.key === 'Enter') ev.currentTarget.blur(); }} /></label>`)}</div>`;
      break;
    }
    case 'list': {
      const items = listItems(cv) || [];
      ctl = html`<button type="button" class="tn-f-list" onClick=${() => openUi({ kind: 'list', tid, key: rowKey, cid: col.id })}>
        ${isNumType(col.itemType || 'float') && items.length ? html`<${Spark} nums=${items.map(Number)} w=${80} h=${20} />` : html`<${Icon} name="list" size=${15} />`}
        <span class="grow">${displayText(col, cv, 80)}</span><span class="btn btn-xs btn-secondary">Edit</span></button>`;
      break;
    }
    default: {
      const text = draft != null ? draft : cv;
      const multi = col.multiline || String(cv).includes('\n');
      ctl = multi
        ? html`<textarea id=${id} class="input textarea" rows=${Math.max(3, Math.min(10, String(text).split('\n').length + 1))} value=${text}
            onInput=${(ev) => setDraft(ev.currentTarget.value)} onChange=${(ev) => commitText(ev.currentTarget.value)}
            onKeyDown=${(ev) => { if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); commitText(ev.currentTarget.value); } if (ev.key === 'Escape' && draft != null) { ev.preventDefault(); ev.stopPropagation(); setDraft(null); } }}></textarea>`
        : html`<input id=${id} class="input input-sm" value=${text} onInput=${(ev) => setDraft(ev.currentTarget.value)} onChange=${(ev) => commitText(ev.currentTarget.value)}
            onKeyDown=${(ev) => { if (ev.key === 'Enter') { ev.preventDefault(); commitText(ev.currentTarget.value); } if (ev.key === 'Escape' && draft != null) { ev.preventDefault(); ev.stopPropagation(); setDraft(null); } }} />`;
    }
  }
  const meta = [col.unit, num ? rangeText(col) : ''].filter(Boolean).join(' · ');
  return html`<div class=${cx('tn-field', e && (e.conflict ? 'is-conflict' : 'is-staged'))} data-cid=${col.id}>
    <div class="tn-f-top">
      <label class="tn-f-lbl" for=${id}>${col.label || col.id}</label>
      ${meta && html`<span class="tn-f-meta">${meta}</span>`}
      ${!colEditable(col) && html`<span class="tn-f-meta" title=${lockReason(col)}><${Icon} name="lock" size=${11} /> ${lockReason(col)}</span>`}
      <span class="grow"></span>
      ${e && html`<span class="tn-f-was" title=${e.conflict ? `Someone changed this to ${displayText(col, e.conflict.current)}` : `Saved value: ${displayText(col, e.from)}`}>
        <span>${e.conflict ? 'conflict · theirs ' : 'was '}${displayText(col, e.conflict ? e.conflict.current : e.from, 32)}</span>
        <button type="button" class="icon-btn icon-btn-sm" title="Discard this change" aria-label=${`Discard change to ${col.label}`} onClick=${() => discard([cellId(tid, rowKey, col.id)], 'Discard ' + (col.label || col.id))}><${Icon} name="undo" size=${13} /></button></span>`}
      ${!canPush && colEditable(col) && html`<button type="button" class="btn btn-xs btn-ghost" onClick=${() => openUi({ kind: 'propose', tid, key: rowKey, cid: col.id })}>Propose…</button>`}
      <button type="button" class=${cx('icon-btn icon-btn-sm', showHist && 'is-active')} title="History of this value" aria-label=${`History of ${col.label}`} aria-expanded=${String(showHist)} onClick=${() => setShowHist(!showHist)}><${Icon} name="history" size=${13} /></button>
    </div>
    ${ctl}
    ${err && html`<div class="tn-err" role="alert">${err}</div>`}
    ${col.tooltip && html`<div class="tn-f-help">${col.tooltip}</div>`}
    ${showHist && html`<div class="tn-f-hist"><${HistoryList} tid=${tid} rowKey=${rowKey} column=${col.id} limit=${8} /></div>`}
  </div>`;
}

export function RowDrawer({ tid, rowKey, focus, onClose }) {
  const t = schemaTable(tid);
  useStore(repoStore, (s) => s.version);
  const canPush = useStore(repoStore, (s) => s.canPush);
  const entries = useEntries();
  const threads = useStore(discussStore, (s) => s.threads);
  const route = useRoute();
  const bodyRef = useRef(null);
  const row = t && rowOf(tid, rowKey);
  useEffect(() => {
    if (!focus || !bodyRef.current) return;
    requestAnimationFrame(() => {
      const f = bodyRef.current && bodyRef.current.querySelector(`.tn-field[data-cid="${CSS.escape(focus)}"]`);
      if (f) { f.scrollIntoView({ block: 'center' }); const inp = f.querySelector('input,textarea,select,button.tn-switch-btn,.tn-f-list'); if (inp) inp.focus({ preventScroll: true }); f.classList.add('is-flash'); setTimeout(() => f.classList.remove('is-flash'), 1300); }
    });
  }, [tid, rowKey, focus]);
  useEffect(() => { if (t && !row) onClose(); }, [row]);
  useEffect(() => { const db = bodyRef.current && bodyRef.current.closest('.drawer-body'); if (db && !focus) db.scrollTop = 0; }, [tid, rowKey]);
  if (!t || !row) return null;
  const rows = sortedRows(tid), idx = rows.findIndex((r) => r.key === rowKey);
  const step = (d) => { const n = rows[idx + d]; if (n) openDrawer(tid, n.key); };
  const nStaged = Object.values(entries).filter((e) => e.table === tid && e.key === rowKey).length;
  const open = threadsFor(threads, { type: 'row', table: tid, key: rowKey }, { openOnly: true });
  // fields by group
  const groups = [], byG = new Map();
  for (const c of t.columns) { const g = c.group || ''; if (!byG.has(g)) { byG.set(g, []); groups.push(g); } byG.get(g).push(c); }
  const pvs = (t.previews || []).filter((p) => p && p.expr), pvDone = new Set();
  const kids = childTablesOf(tid);
  const parentT = t.parent && schemaTable(t.parent), pk = parentKeyOf(rowKey), prow = parentT && rowOf(parentT.id, pk);
  const inTable = route.name === 'tuning' && route.id === tid;
  const headerExtra = html`<span class="tn-d-nav">
    <button type="button" class="icon-btn icon-btn-sm" title="Previous row" aria-label="Previous row" disabled=${idx <= 0} onClick=${() => step(-1)}><${Icon} name="chevron-up" size=${16} /></button>
    <button type="button" class="icon-btn icon-btn-sm" title="Next row" aria-label="Next row" disabled=${idx < 0 || idx >= rows.length - 1} onClick=${() => step(1)}><${Icon} name="chevron-down" size=${16} /></button></span>`;
  return html`<${Drawer} title=${row.name} onClose=${onClose} width=${480} class="tn-drawer" headerExtra=${headerExtra}>
    <div class="tn-d-body" key=${tid + '/' + rowKey} ref=${bodyRef} onKeyDown=${(ev) => { if (ev.altKey && (ev.key === 'ArrowUp' || ev.key === 'ArrowDown')) { ev.preventDefault(); step(ev.key === 'ArrowUp' ? -1 : 1); } }}>
      <div class="tn-d-meta">
        <span class="tn-d-crumb"><${Icon} name="table" size=${13} /> ${tableLabel(tid)}</span>
        ${nStaged > 0 && html`<span class="badge badge-accent">${plural(nStaged, 'unsaved change')}</span>`}
        ${!canPush && html`<span class="badge badge-neutral"><${Icon} name="eye" size=${11} /> Read-only</span>`}
      </div>
      ${prow && html`<p class="tn-d-parent">Part of <button type="button" class="tn-link" onClick=${() => openDrawer(parentT.id, pk)}>${prow.name}</button></p>`}
      <div class="tn-d-acts">
        <button type="button" class="btn btn-sm btn-secondary" onClick=${() => openUi({ kind: 'propose', tid, key: rowKey })}><${Icon} name="swap" size=${14} /> Propose a change</button>
        <button type="button" class="btn btn-sm btn-secondary" onClick=${() => openUi({ kind: 'comment', tid, key: rowKey })}><${Icon} name="comment" size=${14} /> Comment on this row</button>
        ${!inTable && html`<a class="btn btn-sm btn-ghost" href=${href.tuning(tid, { row: rowKey })} onClick=${onClose}><${Icon} name="table" size=${14} /> Show in table</a>`}
      </div>
      ${open.length > 0 && html`<section class="tn-d-sec"><h3 class="tn-d-h">Open discussions <span class="muted">${open.length}</span></h3>
        <ul class="tn-d-threads">${open.map((th) => html`<li key=${th.number}><a href=${href.discussions(th.number)} onClick=${onClose}>
          <${Icon} name=${th.target.to != null ? 'swap' : 'comment'} size=${14} /><span>#${th.number} ${th.title}</span></a></li>`)}</ul></section>`}
      ${groups.map((g) => html`<section class="tn-d-sec" key=${'g' + g}>
        ${(g || groups.length > 1) && html`<h3 class="tn-d-h">${g || 'General'}</h3>`}
        ${byG.get(g).map((c) => html`<${DrawerField} key=${c.id} tid=${tid} rowKey=${rowKey} col=${c} e=${entries[cellId(tid, rowKey, c.id)] || null} canPush=${canPush} />`)}
        ${pvs.filter((p) => (p.group || '') === g && g !== '').map((pv) => { pvDone.add(pv.id); return html`<div class="tn-pv-wrap" key=${'pv' + pv.id}><${PreviewBlock} tid=${tid} rowKey=${rowKey} pv=${pv} current=${currentValue} /></div>`; })}
      </section>`)}
      ${pvs.some((p) => !pvDone.has(p.id)) && html`<section class="tn-d-sec"><h3 class="tn-d-h">Previews</h3>
        ${pvs.filter((p) => !pvDone.has(p.id)).map((pv) => html`<div class="tn-pv-wrap" key=${'pv' + pv.id}><${PreviewBlock} tid=${tid} rowKey=${rowKey} pv=${pv} current=${currentValue} /></div>`)}</section>`}
      ${kids.map((k) => {
        const kr = tableRows(k.id).filter((r) => parentKeyOf(r.key) === rowKey);
        const sum = k.columns.filter((c) => !c.isKey).slice(0, 3);
        return html`<section class="tn-d-sec" key=${'k' + k.id}><h3 class="tn-d-h">${k.label || k.id} <span class="muted">${kr.length}</span>
            <a class="tn-d-hlink" href=${href.tuning(k.id)} onClick=${onClose}>Open table</a></h3>
          ${kr.length ? html`<ul class="tn-d-kids">${kr.map((r) => {
            const dirty = Object.values(entries).some((e) => e.table === k.id && e.key === r.key);
            return html`<li key=${r.key}><button type="button" class="tn-d-kid" onClick=${() => openDrawer(k.id, r.key)}>
              ${dirty && html`<span class="tn-sdot"></span>`}<span class="tn-d-kid-n">${lastNamePart(r.name)}</span>
              <span class="tn-d-kid-v">${sum.map((c) => html`<span><span class="muted">${c.label || c.id}</span> ${displayText(c, currentValue(k.id, r.key, c.id), 18)}</span>`)}</span>
              <${Icon} name="chevron-right" size=${14} /></button></li>`;
          })}</ul>` : html`<p class="muted tn-d-none">No ${k.rowLabel ? nounPlural(k.rowLabel) : 'rows'} for this ${t.rowLabel || 'row'}.</p>`}
        </section>`;
      })}
      <section class="tn-d-sec"><h3 class="tn-d-h">History</h3><${HistoryList} tid=${tid} rowKey=${rowKey} />
        <a class="tn-d-hlink" href=${href.history({ table: tid })} onClick=${onClose}>All changes to ${t.label || t.id}</a></section>
      <details class="tn-d-tech"><summary>Technical details</summary><dl><dt>Table</dt><dd><code>${tid}</code></dd><dt>Row key</dt><dd><code>${rowKey}</code></dd></dl></details>
    </div>
  <//>`;
}
