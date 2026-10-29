// Cell editors (App.html §9–10): inline input, enum/flags/colour/text popovers, list editor, plus the
// "Propose a change" and "Comment on this row" dialogs.
import { html, cx, plural, isMac } from '../lib.js';
import { useState, useRef, useEffect, useLayoutEffect } from '../../vendor/hooks.module.js';
import { Icon } from '../icons.js';
import { Popover, Modal } from '../components/overlay.js';
import { toast } from '../components/toast.js';
import { AutoTextarea } from '../components/ui.js';
import { repoStore, cellValue } from '../repo.js';
import { createThread } from '../discuss.js';
import { href, navigate } from '../router.js';
import { parseInput, editText, nudge, isNumType, canon, canonColor, listItems, itemTypeOf, parseItems, parseNumberText,
  fmtPlain, colEditable, displayText, isListy, vecLen } from '../canon.js';
import { stage, currentValue, closeUi, openUi } from './staging.js';
import { colOf, rowOf, rangeText, typeText, tableLabel, lockReason } from './model.js';
import { ValueView, numText } from './cells.js';
import { LineChart, compactNum } from './preview.js';

const modK = isMac ? '⌘' : 'Ctrl';

/** Which editor a column uses: 'inline' (text box in place) or a popover kind. */
export function editorKind(col, cv) {
  if (col.type === 'bool') return 'bool';
  if (col.type === 'list') return 'list';
  if (col.type === 'enum') return 'enum';
  if (col.type === 'flags') return 'flags';
  if (col.type === 'color') return 'color';
  if (col.type === 'string' && (col.multiline || String(cv || '').includes('\n'))) return 'text';
  return 'inline';
}
export function toggleBool(tid, key, col) {
  const cv = currentValue(tid, key, col.id);
  return stage([{ table: tid, key, column: col.id, to: cv === 'true' ? 'false' : 'true' }], { label: col.label || col.id });
}
/**
 * Start editing a cell from anywhere. Returns 'inline' when the caller should show its own text box.
 * anchor = element the popover attaches to. initial = a typed character that replaces the value.
 */
export function startEdit(tid, key, col, anchor, initial) {
  if (!repoStore.get().canPush) { openUi({ kind: 'propose', tid, key, cid: col.id }); return null; }
  if (!colEditable(col)) { toast(lockReason(col), { detail: 'This value comes from the game project. Ask a developer to change it there.', duration: 2600 }); return null; }
  const cv = currentValue(tid, key, col.id), k = editorKind(col, cv);
  if (k === 'bool') { toggleBool(tid, key, col); return null; }
  if (k === 'inline') return 'inline';
  openUi({ kind: k, tid, key, cid: col.id, anchor, initial });
  return null;
}

// ------------------------------------------------------------- inline input
/**
 * Text box editing one value. onDone(result) with result = 'commit' | 'cancel', plus dir for Enter/Tab moves.
 * Validates with parseInput; Enter/Tab stage, Esc cancels, ↑/↓ nudge numbers (Shift ×10).
 */
export function CellInput({ tid, rowKey, col, initial, onDone, class: cls, multi, autoSelect = true }) {
  const cv = currentValue(tid, rowKey, col.id);
  const [text, setText] = useState(() => (initial != null ? initial : cv == null ? '' : editText(col, cv)));
  const ref = useRef(null), done = useRef(false);
  const num = isNumType(col.type);
  const r = parseInput(col, text);
  useLayoutEffect(() => {
    const el = ref.current; if (!el) return;
    el.focus({ preventScroll: true });
    if (initial == null && autoSelect) el.select(); else { const n = el.value.length; el.setSelectionRange(n, n); }
  }, []);
  const finish = (commit, dir, fromBlur) => {
    if (done.current) return true;
    if (commit) {
      const p = parseInput(col, ref.current ? ref.current.value : text);
      if (!p.ok) {
        if (fromBlur) { done.current = true; toast(`Not changed: ${col.label || col.id}`, { kind: 'error', detail: p.error }); onDone('cancel'); return false; }
        if (ref.current && ref.current.animate) ref.current.animate([{ transform: 'translateX(-3px)' }, { transform: 'translateX(3px)' }, { transform: 'none' }], { duration: 160 });
        return false;
      }
      done.current = true;
      stage([{ table: tid, key: rowKey, column: col.id, to: p.value }], { label: col.label || col.id });
      onDone('commit', dir);
      return true;
    }
    done.current = true; onDone('cancel'); return true;
  };
  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); return; }
    if (e.key === 'Enter' && (!multi || e.ctrlKey || e.metaKey)) { e.preventDefault(); e.stopPropagation(); finish(true, e.shiftKey ? 'up' : 'down'); return; }
    if (e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); finish(true, e.shiftKey ? 'left' : 'right'); return; }
    if (num && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault(); e.stopPropagation();
      const p = parseInput(col, text);
      setText(nudge(col, p.ok ? p.value : (cv || '0'), e.key === 'ArrowUp' ? 1 : -1, e.shiftKey));
    }
  };
  const hint = r.ok ? (num ? [rangeText(col), '↑↓ nudge · Shift ×10'].filter(Boolean).join(' · ') : vecLen(col.type) > 0 ? 'Comma-separated, e.g. 0, -24' : '') : '';
  const Tag = multi ? 'textarea' : 'input';
  return html`<div class=${cx('tn-edit', num && 'is-num', !r.ok && 'is-bad', cls)} onMouseDown=${(e) => e.stopPropagation()} onClick=${(e) => e.stopPropagation()}>
    <${Tag} ref=${ref} class="tn-edit-in" value=${text} spellcheck=${col.type === 'string'} autocomplete="off" aria-label=${col.label || col.id}
      aria-invalid=${String(!r.ok)} onInput=${(e) => setText(e.currentTarget.value)} onKeyDown=${onKey}
      onBlur=${() => setTimeout(() => finish(true, null, true), 0)} />
    ${!r.ok ? html`<div class="tn-edit-msg is-err" role="alert">${r.error}</div>` : hint && html`<div class="tn-edit-msg">${hint}</div>`}
  </div>`;
}

// ------------------------------------------------------------- popovers
function EnumPop({ tid, rowKey, col, anchor, initial, onClose }) {
  const cv = currentValue(tid, rowKey, col.id), opts = col.options || [];
  const [q, setQ] = useState(opts.length > 7 && initial ? initial : '');
  const f = q.trim().toLowerCase();
  const shown = opts.filter((o) => !f || o.toLowerCase().includes(f));
  const start = initial && opts.length <= 7 ? opts.findIndex((o) => o.toLowerCase().startsWith(initial.toLowerCase())) : opts.indexOf(cv);
  const [act, setAct] = useState(Math.max(0, start));
  const a = Math.max(0, Math.min(act, shown.length - 1));
  const pick = (v) => { onClose(); stage([{ table: tid, key: rowKey, column: col.id, to: v }], { label: col.label || col.id }); };
  const onKey = (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setAct(Math.max(0, Math.min(shown.length - 1, a + (e.key === 'ArrowDown' ? 1 : -1)))); }
    else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); if (shown[a] !== undefined) pick(shown[a]); }
  };
  return html`<${Popover} anchor=${anchor} onClose=${onClose} label=${col.label} width=${Math.max(200, anchor && anchor.getBoundingClientRect ? anchor.getBoundingClientRect().width : 200)} class="tn-pop">
    <div class="tn-pop-list" onKeyDown=${onKey} tabindex="-1" data-autofocus=${opts.length <= 7 || undefined} role="listbox" aria-label=${col.label}>
      ${opts.length > 7 && html`<div class="tn-pop-q"><input class="input input-sm" placeholder="Filter…" value=${q} data-autofocus onInput=${(e) => { setQ(e.currentTarget.value); setAct(0); }} /></div>`}
      ${shown.map((o, i) => html`<button type="button" role="option" aria-selected=${String(o === cv)} class=${cx('menu-item', i === a && 'is-act')} onClick=${() => pick(o)} onMouseEnter=${() => setAct(i)}>
        <span class="tn-ck">${o === cv && html`<${Icon} name="check" size=${14} />`}</span><span class="menu-label">${o}</span></button>`)}
      ${!shown.length && html`<div class="muted tn-pop-none">No match</div>`}
    </div>
  <//>`;
}

function FlagsPop({ tid, rowKey, col, anchor, onClose }) {
  const cur = (currentValue(tid, rowKey, col.id) || '').split('|').filter(Boolean);
  const set = (list) => stage([{ table: tid, key: rowKey, column: col.id, to: canon(col, list.join('|')) }], { label: col.label || col.id, coalesce: 'flags:' + tid + rowKey + col.id });
  const toggle = (o) => set(cur.includes(o) ? cur.filter((x) => x !== o) : [...cur, o]);
  return html`<${Popover} anchor=${anchor} onClose=${onClose} label=${col.label} width=${230} class="tn-pop">
    <div class="tn-pop-list" role="group" aria-label=${col.label}>
      ${(col.options || []).map((o, i) => html`<button type="button" role="checkbox" aria-checked=${String(cur.includes(o))} class="menu-item" data-autofocus=${i === 0 || undefined} onClick=${() => toggle(o)}>
        <span class="tn-ck">${cur.includes(o) && html`<${Icon} name="check" size=${14} />`}</span><span class="menu-label">${o}</span></button>`)}
      <div class="menu-sep"></div>
      <div class="tn-pop-foot"><span class="muted">Click to turn on or off</span><button type="button" class="btn btn-sm btn-ghost" onClick=${() => set([])}>None</button></div>
    </div>
  <//>`;
}

function ColorPop({ tid, rowKey, col, anchor, onClose }) {
  const cv = currentValue(tid, rowKey, col.id) || '#FFFFFFFF';
  const [hex, setHex] = useState(cv);
  const v = canonColor(hex);
  const rgb = (v || cv).slice(0, 7).toLowerCase(), alpha = parseInt((v || cv).slice(7, 9) || 'FF', 16);
  const hex2 = (n) => ('0' + Number(n).toString(16)).slice(-2).toUpperCase();
  const ok = () => { if (!v) return; onClose(); stage([{ table: tid, key: rowKey, column: col.id, to: v }], { label: col.label || col.id }); };
  return html`<${Popover} anchor=${anchor} onClose=${onClose} label=${col.label} width=${280} class="tn-pop" trap=${true}>
    <div class="tn-pop-pad" onKeyDown=${(e) => { if (e.key === 'Enter') { e.preventDefault(); ok(); } }}>
      <div class="tn-row"><input type="color" class="tn-color-in" value=${rgb} aria-label="Pick a colour" onInput=${(e) => setHex(e.currentTarget.value.toUpperCase() + hex2(alpha))} />
        <input class=${cx('input input-sm tn-mono', !v && 'is-invalid')} value=${hex} data-autofocus spellcheck=${false} aria-label="Hex colour" onInput=${(e) => setHex(e.currentTarget.value)} /></div>
      <label class="tn-row tn-alpha"><span class="muted">Opacity</span><input type="range" min="0" max="255" value=${alpha} onInput=${(e) => setHex(rgb.toUpperCase() + hex2(e.currentTarget.value))} /><span class="muted tn-tnum">${Math.round((alpha / 255) * 100)}%</span></label>
      <div class="tn-color-prev"><span class="tn-swatch tn-swatch-wide"><i style=${{ background: (v || cv).slice(0, 7), opacity: alpha / 255 }}></i></span></div>
      ${!v && html`<div class="tn-err">Use #RRGGBB or #RRGGBBAA</div>`}
      <div class="tn-pop-foot"><span class="muted">Enter to apply</span><button type="button" class="btn btn-sm btn-ghost" onClick=${onClose}>Cancel</button><button type="button" class="btn btn-sm btn-primary" disabled=${!v} onClick=${ok}>Apply</button></div>
    </div>
  <//>`;
}

function TextPop({ tid, rowKey, col, anchor, initial, onClose }) {
  const cv = currentValue(tid, rowKey, col.id) || '';
  const [text, setText] = useState(initial != null ? initial : cv);
  const ok = () => { onClose(); stage([{ table: tid, key: rowKey, column: col.id, to: text.replace(/\r\n/g, '\n') }], { label: col.label || col.id }); };
  const w = anchor && anchor.getBoundingClientRect ? Math.max(360, Math.min(560, anchor.getBoundingClientRect().width + 60)) : 380;
  return html`<${Popover} anchor=${anchor} onClose=${onClose} label=${col.label} width=${w} class="tn-pop" trap=${true}>
    <div class="tn-pop-pad">
      <div class="tn-pop-title">${col.label || col.id}</div>
      <${AutoTextarea} value=${text} minRows=${5} maxRows=${14} data-autofocus spellcheck=${true} onInput=${(e) => setText(e.currentTarget.value)}
        onKeyDown=${(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); ok(); } }} />
      <div class="tn-pop-foot"><span class="muted">${modK}+Enter to apply</span><button type="button" class="btn btn-sm btn-ghost" onClick=${onClose}>Cancel</button><button type="button" class="btn btn-sm btn-primary" onClick=${ok}>Apply</button></div>
    </div>
  <//>`;
}

/** Small popover with a text box (card badges, mobile). */
function ValuePop({ tid, rowKey, col, anchor, onClose }) {
  return html`<${Popover} anchor=${anchor} onClose=${onClose} label=${col.label} width=${250} class="tn-pop" trap=${true}>
    <div class="tn-pop-pad">
      <div class="tn-pop-title">${col.label || col.id}${col.unit && html` <span class="muted">${col.unit}</span>`}</div>
      <${CellInput} tid=${tid} rowKey=${rowKey} col=${col} class="tn-edit-pop" onDone=${() => onClose()} />
    </div>
  <//>`;
}

// ------------------------------------------------------------- list editor (modal)
function ListEditor({ tid, rowKey, col, onClose }) {
  const it = itemTypeOf(col), numeric = isNumType(it), editable = colEditable(col) && repoStore.get().canPush;
  const saved = listItems(cellValue(tid, rowKey, col.id) || '[]') || [];
  const startItems = listItems(currentValue(tid, rowKey, col.id) || '[]') || [];
  const toStr = (x) => (numeric ? fmtPlain(x) : String(x));
  const [ws, setWs] = useState(() => startItems.map(toStr));
  const [pane, setPane] = useState('values');
  const [paste, setPaste] = useState('');
  const [perr, setPerr] = useState('');
  const listRef = useRef(null);
  const focusIdx = useRef(null);
  useEffect(() => {
    if (focusIdx.current == null || !listRef.current) return;
    const el = listRef.current.querySelector(`[data-li="${focusIdx.current}"]`);
    focusIdx.current = null;
    if (el) { el.focus(); if (el.select) el.select(); }
  });
  const parsed = ws.map((s) => (numeric ? parseNumberText(s, col.type === 'list' ? col : null, it === 'int') : { ok: true, value: s }));
  const res = parseItems(col, ws);
  const row = rowOf(tid, rowKey);
  const staged = currentValue(tid, rowKey, col.id);
  const dirty = res.ok && res.value !== staged;
  const set = (i, v) => setWs((a) => { const b = a.slice(); b[i] = v; return b; });
  const add = () => { focusIdx.current = ws.length; setWs((a) => [...a, numeric ? (a.length ? a[a.length - 1] : '0') : it === 'enum' ? (col.options || [''])[0] : it === 'bool' ? 'false' : it === 'color' ? '#FFFFFFFF' : '']); };
  const move = (i, d) => { const j = i + d; if (j < 0 || j >= ws.length) return; setWs((a) => { const b = a.slice(); [b[i], b[j]] = [b[j], b[i]]; return b; }); };
  const remove = (i) => setWs((a) => a.filter((_, k) => k !== i));
  const apply = () => {
    if (!res.ok) { toast("Can't apply this list", { kind: 'error', detail: res.error }); return; }
    stage([{ table: tid, key: rowKey, column: col.id, to: res.value }], { label: col.label || col.id });
    onClose();
  };
  const doPaste = (append) => {
    const items = paste.replace(/\s+$/, '').split(numeric || it === 'bool' ? /[\n\t,;]+|\s+/ : /\r?\n/).map((s) => (numeric ? s.trim() : s)).filter((s) => !(numeric && s === ''));
    const next = (append ? ws : []).concat(items);
    const t = parseItems(col, next);
    if (!t.ok && numeric) { setPerr(t.error); return; }
    setWs(next); setPerr(''); setPaste(''); setPane('values');
    toast(`${append ? 'Appended' : 'Pasted'} ${plural(items.length, 'item')}`, { duration: 2000 });
  };
  const cur = parsed.map((p) => (p.ok ? Number(p.value) : NaN));
  const changedAt = (i) => i >= saved.length || (numeric ? !(parsed[i].ok && Number(saved[i]) === Number(parsed[i].value)) : String(saved[i]) !== ws[i]);
  const foot = !res.ok ? html`<span class="tn-err">${res.error}</span>`
    : !dirty ? html`<span class="muted">${plural(ws.length, it === 'string' ? 'line' : 'item')}${staged === cellValue(tid, rowKey, col.id) ? ' · matches the saved version' : ' · already in your changes'}</span>`
    : html`<span class="tn-accent">${plural(ws.length, it === 'string' ? 'line' : 'item')} · not applied yet</span>`;
  const onRowKey = (e, i) => {
    if (numeric && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && !e.altKey) {
      e.preventDefault();
      const r = parseNumberText(ws[i], null, it === 'int'); if (!r.ok) return;
      set(i, nudge({ type: it, step: col.step, min: col.min, max: col.max, precision: col.precision }, String(r.value), e.key === 'ArrowUp' ? 1 : -1, e.shiftKey));
    } else if (e.key === 'Enter' && !(e.ctrlKey || e.metaKey) && e.currentTarget.tagName !== 'TEXTAREA') {
      e.preventDefault();
      if (i + 1 < ws.length) { focusIdx.current = i + 1; setWs((a) => a.slice()); } else if (editable) add();
    }
  };
  return html`<${Modal} title=${html`${col.label || col.id} <span class="muted tn-fw4">· ${row ? row.name : rowKey}</span>`} onClose=${onClose} size=${numeric ? 'lg' : 'md'} class="tn-le"
    footer=${html`<div class="tn-le-foot">${foot}</div><span class="grow"></span>
      ${editable && html`<button type="button" class="btn btn-ghost" onClick=${() => setWs(saved.map(toStr))}><${Icon} name="undo" size=${14} /> Reset</button>`}
      <button type="button" class="btn btn-secondary" onClick=${onClose}>${editable ? 'Cancel' : 'Close'}</button>
      ${editable && html`<button type="button" class="btn btn-primary" disabled=${!dirty} onClick=${apply}>Apply</button>`}`}>
    <div class="tn-le-sub muted">${col.tooltip || typeText(col)}${rangeText(col) ? ' · Range ' + rangeText(col) : ''}${col.unit ? ' · ' + col.unit : ''}</div>
    <div class=${cx('tn-le-body', numeric && 'is-num')} onKeyDown=${(e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); apply(); } }}>
      ${numeric && html`<div class="tn-le-chart">
        <${LineChart} height=${170} series=${[{ data: saved.map(Number), kind: 'old' }, { data: cur, kind: 'cur', changed: cur.map((_, i) => changedAt(i)) }]}
          readout=${(i) => html`<b>#${i}</b>${i < cur.length ? html` · yours <b>${numText(fmtPlain(cur[i]))}</b>` : ''}${i < saved.length ? html` · saved ${numText(fmtPlain(saved[i]))}` : ''}`}
          onPick=${(i) => { setPane('values'); focusIdx.current = i; setWs((a) => a.slice()); }} ariaLabel=${`${col.label} values`} />
        <div class="tn-le-legend"><span><i class="is-old"></i>Saved</span><span><i></i>Your version</span></div>
        <div class="tn-le-stats">${(() => { const ok = cur.filter(isFinite), sum = ok.reduce((a, b) => a + b, 0); return [['Count', ok.length], ['Min → Max', ok.length ? compactNum(Math.min(...ok)) + ' → ' + compactNum(Math.max(...ok)) : '—'], ['Total', ok.length ? compactNum(sum) : '—']].map(([k, v]) => html`<div class="tn-le-stat"><div class="muted">${k}</div><b>${v}</b></div>`); })()}</div>
      </div>`}
      <div class="tn-le-side">
        <div class="seg-tabs seg-tabs-sm" role="tablist">
          <button type="button" role="tab" aria-selected=${String(pane === 'values')} class=${cx('seg-tab', pane === 'values' && 'is-active')} onClick=${() => setPane('values')}>${it === 'string' ? 'Lines' : 'Items'}</button>
          ${editable && html`<button type="button" role="tab" aria-selected=${String(pane === 'paste')} class=${cx('seg-tab', pane === 'paste' && 'is-active')} onClick=${() => setPane('paste')}>Paste</button>`}
        </div>
        ${pane === 'values' ? html`<div class="tn-le-list" ref=${listRef}>
          ${ws.map((s, i) => {
            const ch = changedAt(i), bad = !parsed[i].ok;
            const acts = editable && html`<span class="tn-li-acts">
              <button type="button" class="icon-btn icon-btn-sm" aria-label=${`Move item ${i} up`} disabled=${i === 0} onClick=${() => move(i, -1)}><${Icon} name="chevron-up" size=${14} /></button>
              <button type="button" class="icon-btn icon-btn-sm" aria-label=${`Move item ${i} down`} disabled=${i === ws.length - 1} onClick=${() => move(i, 1)}><${Icon} name="chevron-down" size=${14} /></button>
              <button type="button" class="icon-btn icon-btn-sm" aria-label=${`Remove item ${i}`} onClick=${() => remove(i)}><${Icon} name="trash" size=${14} /></button></span>`;
            let ctl;
            if (it === 'string') ctl = html`<textarea class=${cx('input textarea', ch && 'is-ch')} rows="2" data-li=${i} readOnly=${!editable} value=${s} onInput=${(e) => set(i, e.currentTarget.value)} aria-label=${`Line ${i}`}></textarea>`;
            else if (it === 'enum' || it === 'bool') ctl = html`<select class=${cx('input select', ch && 'is-ch')} data-li=${i} disabled=${!editable} value=${s} onChange=${(e) => set(i, e.currentTarget.value)} aria-label=${`Item ${i}`}>
              ${(it === 'bool' ? ['true', 'false'] : col.options || []).map((o) => html`<option value=${o}>${o}</option>`)}</select>`;
            else ctl = html`<input class=${cx('input input-sm', numeric ? 'tn-num' : 'tn-mono', ch && 'is-ch', bad && 'is-invalid')} data-li=${i} value=${s} readOnly=${!editable} spellcheck=${false}
              title=${bad ? parsed[i].error : ''} aria-label=${`Item ${i}`} aria-invalid=${String(bad)} onInput=${(e) => set(i, e.currentTarget.value)} onKeyDown=${(e) => onRowKey(e, i)} />`;
            let dp = null;
            if (numeric && i > 0 && parsed[i].ok && parsed[i - 1].ok && Number(parsed[i - 1].value)) {
              const pct = (Number(parsed[i].value) / Number(parsed[i - 1].value) - 1) * 100;
              dp = html`<span class=${cx('tn-dp', pct > 0.05 && 'is-up', pct < -0.05 && 'is-dn')}>${(pct > 0 ? '+' : '') + pct.toFixed(Math.abs(pct) < 10 ? 1 : 0)}%</span>`;
            }
            return html`<div class=${cx('tn-li', it === 'string' && 'is-str')} key=${i}><span class="tn-ix">${i}</span>${ctl}${numeric ? (dp || html`<span class="tn-dp"></span>`) : null}${acts}</div>`;
          })}
          ${!ws.length && html`<div class="muted tn-le-empty">The list is empty.</div>`}
          ${editable && html`<div class="tn-le-add"><button type="button" class="btn btn-sm btn-secondary" onClick=${add}><${Icon} name="plus" size=${14} /> Add ${it === 'string' ? 'line' : 'item'}</button>
            ${numeric && html`<span class="muted">↑↓ nudge · Enter = next row</span>`}</div>`}
        </div>` : html`<div class="tn-le-paste">
          <p class="muted">${numeric ? 'Paste a column or row straight from a spreadsheet. Values can be separated by new lines, tabs or commas.' : `One ${it === 'string' ? 'line' : 'item'} per line.`}</p>
          <textarea class="input textarea" rows="8" value=${paste} data-autofocus placeholder=${numeric ? '100\n135\n182' : 'First line\nSecond line'} onInput=${(e) => setPaste(e.currentTarget.value)}></textarea>
          ${perr && html`<div class="tn-err">${perr}</div>`}
          <div class="tn-row"><button type="button" class="btn btn-sm btn-primary" onClick=${() => doPaste(false)}>Replace list</button><button type="button" class="btn btn-sm btn-secondary" onClick=${() => doPaste(true)}>Append</button></div>
        </div>`}
      </div>
    </div>
  <//>`;
}

// ------------------------------------------------------------- propose / comment
export function ProposeDialog({ tid, rowKey, cid, onClose }) {
  const t = repoStore.get().schema && repoStore.get().schema.tables.find((x) => x.id === tid);
  const editableCols = t ? t.columns.filter((c) => colEditable(c)) : [];
  const [colId, setColId] = useState(cid || (editableCols[0] && editableCols[0].id));
  const col = colOf(tid, colId);
  const saved = col ? cellValue(tid, rowKey, col.id) : null;
  const mine = col ? currentValue(tid, rowKey, col.id) : null;
  const [text, setText] = useState(() => (col ? editText(col, mine !== saved ? mine : saved) : ''));
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const row = rowOf(tid, rowKey);
  if (!col || !row) return null;
  const locked = !colEditable(col);
  const r = locked ? { ok: false, error: lockReason(col) } : parseInput(col, text);
  const same = r.ok && r.value === saved;
  const changeCol = (id) => { const c = colOf(tid, id); setColId(id); setText(c ? editText(c, cellValue(tid, rowKey, id)) : ''); };
  const submit = async () => {
    if (!r.ok || same || busy) return;
    setBusy(true); setErr('');
    try {
      const th = await createThread({ type: 'cell', table: tid, key: rowKey, column: col.id, from: saved, to: r.value }, { text: comment.trim() });
      onClose();
      toast(`Proposal #${th.number} posted`, { kind: 'success', detail: `${row.name} · ${col.label || col.id}: ${displayText(col, saved, 24)} → ${displayText(col, r.value, 24)}`, action: { label: 'Open', run: () => navigate(href.discussions(th.number)) } });
    } catch (e) { setErr(e.message || String(e)); setBusy(false); }
  };
  const opts = col.type === 'enum' ? col.options || [] : col.type === 'bool' ? ['true', 'false'] : null;
  return html`<${Modal} title="Propose a change" onClose=${onClose} size="md" class="tn-dlg"
    footer=${html`<button type="button" class="btn btn-ghost" onClick=${onClose}>Cancel</button>
      <button type="button" class="btn btn-primary" disabled=${!r.ok || same || busy} onClick=${submit}>${busy ? 'Posting…' : 'Post proposal'}</button>`}>
    <p class="tn-dlg-lead muted">Suggest a new value for the team to discuss. Nothing changes in the game until someone with edit access applies it.</p>
    <div class="tn-dlg-target"><${Icon} name="table" size=${14} /> ${tableLabel(tid)} · <b>${row.name}</b></div>
    <label class="tn-field-lbl">Value
      <select class="input select" value=${col.id} onChange=${(e) => changeCol(e.currentTarget.value)} disabled=${!!cid && !editableCols.length}>
        ${(t.columns.filter((c) => colEditable(c) || c.id === colId)).map((c) => html`<option value=${c.id}>${c.label || c.id}</option>`)}
      </select></label>
    <div class="tn-dlg-now"><span class="muted">Current value</span><span class="tn-dlg-val"><${ValueView} col=${col} cv=${saved} /></span></div>
    <label class="tn-field-lbl">New value${col.unit ? ` (${col.unit})` : ''}
      ${opts ? html`<select class="input select" value=${r.ok ? r.value : text} data-autofocus onChange=${(e) => setText(e.currentTarget.value)}>${opts.map((o) => html`<option value=${o}>${col.type === 'bool' ? (o === 'true' ? 'On' : 'Off') : o}</option>`)}</select>`
        : col.type === 'string' && col.multiline ? html`<${AutoTextarea} value=${text} minRows=${3} data-autofocus onInput=${(e) => setText(e.currentTarget.value)} />`
        : html`<input class=${cx('input', !r.ok && 'is-invalid', isNumType(col.type) && 'tn-num')} value=${text} data-autofocus disabled=${locked} spellcheck=${false}
            aria-invalid=${String(!r.ok)} onInput=${(e) => setText(e.currentTarget.value)} onKeyDown=${(e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }} />`}
      ${!r.ok ? html`<span class="tn-err" role="alert">${r.error}</span>` : same ? html`<span class="muted tn-hint">That's the current value.</span>`
        : html`<span class="muted tn-hint">${displayText(col, saved)} → <b>${displayText(col, r.value)}</b>${isListy(col) ? '' : rangeText(col) ? ' · range ' + rangeText(col) : ''}</span>`}
    </label>
    <label class="tn-field-lbl">Why? (optional)
      <${AutoTextarea} value=${comment} minRows=${3} placeholder="e.g. Bats out-run the player on floor 1" onInput=${(e) => setComment(e.currentTarget.value)} /></label>
    ${err && html`<div class="tn-err-box" role="alert"><${Icon} name="alert" size=${16} />${err}</div>`}
  <//>`;
}

export function CommentDialog({ tid, rowKey, onClose }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const row = rowOf(tid, rowKey);
  const submit = async () => {
    if (!text.trim() || busy) return;
    setBusy(true); setErr('');
    try {
      const th = await createThread({ type: 'row', table: tid, key: rowKey }, { text: text.trim() });
      onClose();
      toast(`Comment #${th.number} posted`, { kind: 'success', action: { label: 'Open', run: () => navigate(href.discussions(th.number)) } });
    } catch (e) { setErr(e.message || String(e)); setBusy(false); }
  };
  return html`<${Modal} title="Comment on this row" onClose=${onClose} size="md" class="tn-dlg"
    footer=${html`<button type="button" class="btn btn-ghost" onClick=${onClose}>Cancel</button>
      <button type="button" class="btn btn-primary" disabled=${!text.trim() || busy} onClick=${submit}>${busy ? 'Posting…' : 'Post comment'}</button>`}>
    <div class="tn-dlg-target"><${Icon} name="table" size=${14} /> ${tableLabel(tid)} · <b>${row ? row.name : rowKey}</b></div>
    <${AutoTextarea} value=${text} minRows=${4} data-autofocus placeholder="What should the team know about this row?" onInput=${(e) => setText(e.currentTarget.value)}
      onKeyDown=${(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submit(); } }} />
    <div class="muted tn-hint">${modK}+Enter to post. It appears under Discussions for everyone on the project.</div>
    ${err && html`<div class="tn-err-box" role="alert"><${Icon} name="alert" size=${16} />${err}</div>`}
  <//>`;
}

/** Render the editor popover/modal for a ui request (used by the global host in stage.js). */
export function EditorFor({ ui, onClose }) {
  const col = colOf(ui.tid, ui.cid);
  if (!col && ui.kind !== 'comment') return null;
  const p = { tid: ui.tid, rowKey: ui.key, col, anchor: ui.anchor, initial: ui.initial, onClose };
  switch (ui.kind) {
    case 'enum': return html`<${EnumPop} ...${p} />`;
    case 'flags': return html`<${FlagsPop} ...${p} />`;
    case 'color': return html`<${ColorPop} ...${p} />`;
    case 'text': return html`<${TextPop} ...${p} />`;
    case 'value': return html`<${ValuePop} ...${p} />`;
    case 'list': return html`<${ListEditor} ...${p} />`;
    case 'propose': return html`<${ProposeDialog} tid=${ui.tid} rowKey=${ui.key} cid=${ui.cid} onClose=${onClose} />`;
    case 'comment': return html`<${CommentDialog} tid=${ui.tid} rowKey=${ui.key} onClose=${onClose} />`;
    default: return null;
  }
}
export { closeUi };
