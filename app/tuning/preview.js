// Previews (Tuning Desk contract §10): a tiny safe expression language (no eval/Function) evaluated per row,
// and a small SVG line chart with hover values (App.html Preview + chartSvg).
import { html, cx } from '../lib.js';
import { useState, useRef } from '../../vendor/hooks.module.js';
import { groupThousands, isNumType } from '../canon.js';
import { cellValue } from '../repo.js';
import { colOf } from './model.js';

const FUNCS = {
  floor: [1, Math.floor], ceil: [1, Math.ceil], round: [1, Math.round], abs: [1, Math.abs], sqrt: [1, Math.sqrt], log: [1, Math.log],
  pow: [2, Math.pow], min: [-1, Math.min], max: [-1, Math.max], clamp: [3, (x, a, b) => Math.min(Math.max(x, a), b)],
};
export const MAX_POINTS = 50;

/** Parse an expression to an AST. Throws Error with a readable message. */
export function parseExpr(src) {
  const s = String(src == null ? '' : src), toks = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) { i++; continue; }
    let m = /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(s.slice(i));
    if (m) { toks.push({ t: 'n', v: parseFloat(m[0]), at: i }); i += m[0].length; continue; }
    m = /^[A-Za-z_][A-Za-z0-9_.]*/.exec(s.slice(i));
    if (m) { toks.push({ t: 'id', v: m[0], at: i }); i += m[0].length; continue; }
    if ('+-*/%^(),'.includes(c)) { toks.push({ t: c, at: i }); i++; continue; }
    throw new Error(`Unexpected “${c}” at position ${i + 1}`);
  }
  let p = 0;
  const peek = () => toks[p];
  const eat = (t) => { const k = toks[p]; if (!k || k.t !== t) throw new Error(`Expected “${t}”` + (k ? ` at position ${k.at + 1}` : ' at the end')); p++; return k; };
  const add = () => { let n = mul(); while (peek() && (peek().t === '+' || peek().t === '-')) { const o = toks[p++].t; n = { op: o, a: n, b: mul() }; } return n; };
  const mul = () => { let n = un(); while (peek() && (peek().t === '*' || peek().t === '/' || peek().t === '%')) { const o = toks[p++].t; n = { op: o, a: n, b: un() }; } return n; };
  const un = () => { if (peek() && peek().t === '-') { p++; return { op: 'neg', a: un() }; } if (peek() && peek().t === '+') { p++; return un(); } return pw(); };
  const pw = () => { const b = prim(); if (peek() && peek().t === '^') { p++; return { op: '^', a: b, b: un() }; } return b; };
  const prim = () => {
    const k = peek(); if (!k) throw new Error('Unexpected end of expression');
    if (k.t === 'n') { p++; return { num: k.v }; }
    if (k.t === '(') { p++; const e = add(); eat(')'); return e; }
    if (k.t === 'id') {
      p++;
      if (peek() && peek().t === '(') {
        const f = FUNCS[k.v]; if (!f) throw new Error(`Unknown function “${k.v}”`);
        p++; const args = [];
        if (!(peek() && peek().t === ')')) { args.push(add()); while (peek() && peek().t === ',') { p++; args.push(add()); } }
        eat(')');
        if (f[0] >= 0 && args.length !== f[0]) throw new Error(`${k.v}() takes ${f[0]} argument${f[0] === 1 ? '' : 's'}`);
        if (f[0] < 0 && !args.length) throw new Error(`${k.v}() needs at least one argument`);
        return { fn: k.v, args };
      }
      return { id: k.v };
    }
    throw new Error(`Unexpected “${k.t}” at position ${k.at + 1}`);
  };
  if (!toks.length) throw new Error('Empty expression');
  const ast = add();
  if (p < toks.length) throw new Error(`Unexpected “${toks[p].v ?? toks[p].t}” at position ${toks[p].at + 1}`);
  return ast;
}
const cache = new Map();
function compiled(src) {
  if (!cache.has(src)) { try { cache.set(src, { ast: parseExpr(src) }); } catch (e) { cache.set(src, { error: e.message }); } }
  return cache.get(src);
}
export function evalAst(n, look) {
  if ('num' in n) return n.num;
  if (n.id !== undefined) return look(n.id);
  if (n.fn) return FUNCS[n.fn][1](...n.args.map((a) => evalAst(a, look)));
  const a = evalAst(n.a, look);
  if (n.op === 'neg') return -a;
  const b = evalAst(n.b, look);
  switch (n.op) { case '+': return a + b; case '-': return a - b; case '*': return a * b; case '/': return a / b; case '%': return a % b; case '^': return Math.pow(a, b); }
  throw new Error('Bad operator');
}

/**
 * Evaluate one preview for a row. get(colId) → canonical value (staged or saved).
 * → {levels, values, error, truncated}
 */
export function previewSeries(tid, pv, get) {
  const out = { levels: [], values: [], error: null, truncated: false };
  const look = (level) => (id) => {
    if (id === 'level') { if (level === undefined) throw new Error('“level” can’t be used in the level range'); return level; }
    const c = colOf(tid, id); if (!c) throw new Error(`Unknown column “${id}”`);
    if (!isNumType(c.type) && c.type !== 'bool') throw new Error(`“${c.label || c.id}” isn’t a number`);
    const v = get(id);
    if (v === null || v === undefined) throw new Error(`“${c.label || c.id}” has no value`);
    if (c.type === 'bool') return v === 'true' ? 1 : 0;
    const n = Number(v); if (!isFinite(n)) throw new Error(`“${c.label || c.id}” has an invalid value`);
    return n;
  };
  try {
    const ce = compiled(pv.expr), cf = compiled(pv.levelFrom == null || pv.levelFrom === '' ? '1' : String(pv.levelFrom)), ct = compiled(pv.levelTo == null || pv.levelTo === '' ? '1' : String(pv.levelTo));
    for (const c of [ce, cf, ct]) if (c.error) throw new Error(c.error);
    const from = Math.round(evalAst(cf.ast, look())); let to = Math.round(evalAst(ct.ast, look()));
    if (!isFinite(from) || !isFinite(to)) throw new Error('The level range isn’t a number');
    if (to < from) throw new Error(`No levels (${from} to ${to})`);
    if (to - from + 1 > MAX_POINTS) { to = from + MAX_POINTS - 1; out.truncated = true; }
    for (let lv = from; lv <= to; lv++) {
      const y = evalAst(ce.ast, look(lv));
      if (!isFinite(y)) throw new Error(`Level ${lv} isn’t a finite number`);
      out.levels.push(lv); out.values.push(y);
    }
  } catch (e) { out.error = e.message; out.levels = []; out.values = []; }
  return out;
}
export function previewUnit(tid, pv, get) {
  const c = pv.unitColumn && colOf(tid, pv.unitColumn);
  const v = c ? get(c.id) : null;
  return v ? String(v) : (pv.unit || '');
}
export function fmtPv(v) {
  const r = Math.abs(v) >= 1000 ? Math.round(v) : +v.toFixed(Math.abs(v) >= 10 ? 2 : 3);
  return groupThousands(String(r));
}
export function compactNum(v) {
  const a = Math.abs(v);
  if (a >= 1e9) return +(v / 1e9).toFixed(1) + 'B';
  if (a >= 1e6) return +(v / 1e6).toFixed(1) + 'M';
  if (a >= 1e4) return +(v / 1e3).toFixed(1) + 'k';
  return groupThousands(String(+v.toFixed(4)));
}
function niceStep(range, n) {
  const raw = range / (n || 4), mag = Math.pow(10, Math.floor(Math.log10(raw || 1))), f = raw / mag;
  return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * mag;
}

/**
 * Line chart (App.html chartSvg). series: [{data:number[], kind:'cur'|'old'}]; xs: x labels.
 * readout(i) → text for the hover line.
 */
export function LineChart({ series, xs, height = 120, compact, readout, onPick, ariaLabel }) {
  const [hover, setHover] = useState(null);
  const ref = useRef(null);
  const W = 320, H = height, L = compact ? 34 : 44, R = 8, T = 8, B = compact ? 16 : 20;
  const all = [];
  for (const s of series) if (s && s.data) for (const v of s.data) if (isFinite(v)) all.push(v);
  if (!all.length) return html`<div class="tn-chart-empty muted">No values</div>`;
  let mn = Math.min(...all), mx = Math.max(...all);
  if (mn > 0 && mn < mx * 0.4) mn = 0;
  if (mn === mx) { mn -= Math.abs(mn) * 0.1 || 1; mx += Math.abs(mx) * 0.1 || 1; }
  const st = niceStep(mx - mn, compact ? 2 : 3); mn = Math.floor(mn / st) * st; mx = Math.ceil(mx / st) * st;
  const n = Math.max(...series.map((s) => (s && s.data ? s.data.length : 0)));
  const X = (i) => L + (n <= 1 ? (W - L - R) / 2 : (i / (n - 1)) * (W - L - R));
  const Y = (v) => T + (1 - (v - mn) / (mx - mn)) * (H - T - B);
  const path = (d) => { let p = ''; d.forEach((v, i) => { if (isFinite(v)) p += (p ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(v).toFixed(1); }); return p; };
  const ticks = []; for (let v = mn; v <= mx + st / 2; v += st) ticks.push(v);
  const every = Math.max(1, Math.ceil(n / (compact ? 6 : 10)));
  const onMove = (e) => {
    const svg = ref.current; if (!svg) return;
    const r = svg.getBoundingClientRect(), x = ((e.clientX - r.left) / r.width) * W;
    const i = n <= 1 ? 0 : Math.max(0, Math.min(n - 1, Math.round(((x - L) / (W - L - R)) * (n - 1))));
    if (i !== hover) setHover(i);
  };
  const cur = series.find((s) => s && s.kind === 'cur');
  return html`<div class="tn-chart">
    <svg ref=${ref} viewBox=${`0 0 ${W} ${H}`} role="img" aria-label=${ariaLabel || 'Chart'} onMouseMove=${onMove} onMouseLeave=${() => setHover(null)}
      onClick=${() => { if (hover != null && onPick) onPick(hover); }}>
      ${ticks.map((v) => html`<line class="tn-ax" x1=${L} x2=${W - R} y1=${Y(v).toFixed(1)} y2=${Y(v).toFixed(1)} />
        <text class="tn-axl" x=${L - 6} y=${(Y(v) + 3.5).toFixed(1)} text-anchor="end">${compactNum(v)}</text>`)}
      ${Array.from({ length: n }, (_, i) => i).filter((i) => i % every === 0 || i === n - 1).map((i) => html`<text class="tn-axl" x=${X(i).toFixed(1)} y=${H - 4} text-anchor="middle">${xs ? xs[i] : i}</text>`)}
      ${cur && cur.data.length > 0 && html`<path class="tn-area" d=${path(cur.data) + `L${X(cur.data.length - 1).toFixed(1)} ${Y(mn).toFixed(1)}L${X(0).toFixed(1)} ${Y(mn).toFixed(1)}Z`} />`}
      ${series.filter(Boolean).map((s) => html`<path class=${s.kind === 'cur' ? 'tn-line' : 'tn-ghost'} d=${path(s.data)} />`)}
      ${cur && cur.data.length <= 50 && cur.data.map((v, i) => isFinite(v) && html`<circle class=${cx('tn-pt', cur.changed && cur.changed[i] && 'is-ch')} cx=${X(i).toFixed(1)} cy=${Y(v).toFixed(1)} r=${hover === i ? 3.6 : 2.2} />`)}
      ${hover != null && html`<line class="tn-guide" x1=${X(hover).toFixed(1)} x2=${X(hover).toFixed(1)} y1=${T} y2=${H - B} />`}
    </svg>
    <div class="tn-chart-read" aria-live="polite">${hover != null && readout ? readout(hover) : html`<span class="muted">${onPick ? 'Hover to read values · click a point to edit it' : 'Hover to read values'}</span>`}</div>
  </div>`;
}

/** One preview block for a row: recomputes from staged values; shows the saved series dashed when they differ. */
export function PreviewBlock({ tid, rowKey, pv, compact, current }) {
  const get = (cid) => current(tid, rowKey, cid);
  const getSaved = (cid) => cellValue(tid, rowKey, cid);
  const cur = previewSeries(tid, pv, get), unit = previewUnit(tid, pv, get);
  if (cur.error) {
    return html`<div class="tn-pv">
      <div class="tn-pv-h"><b>${pv.label || pv.id}</b>${unit && html`<span>· ${unit}</span>`}</div>
      <div class="tn-pv-err" title=${cur.error}>Preview unavailable</div><div class="tn-pv-why muted">${cur.error}</div></div>`;
  }
  const old = previewSeries(tid, pv, getSaved);
  const changed = !old.error && (old.values.length !== cur.values.length || old.values.some((v, i) => v !== cur.values[i]));
  const n = cur.values.length, maxV = Math.max(...cur.values);
  const readout = (i) => html`Lv ${cur.levels[i]} · <b>${fmtPv(cur.values[i])}${unit ? ' ' + unit : ''}</b>${changed && old.values[i] !== undefined && old.values[i] !== cur.values[i] ? html` <span class="muted">(was ${fmtPv(old.values[i])})</span>` : ''}`;
  return html`<div class=${cx('tn-pv', changed && 'is-changed')}>
    <div class="tn-pv-h"><b>${pv.label || pv.id}</b>${unit && html`<span>· ${unit}</span>`}<span class="grow"></span>
      ${changed && html`<span class="tn-pv-chg" title="Recomputed from your unsaved values. The dashed line is the saved version.">changed</span>`}
      ${cur.truncated && html`<span class="muted" title=${`Previews show at most ${MAX_POINTS} levels`}>first ${MAX_POINTS}</span>`}</div>
    <${LineChart} compact=${compact} height=${compact ? 84 : 120} xs=${cur.levels} ariaLabel=${`${pv.label || pv.id} by level`}
      series=${[changed ? { data: old.values, kind: 'old' } : null, { data: cur.values, kind: 'cur' }]} readout=${readout} />
    <div class="tn-pv-legend"><span>Lv ${cur.levels[0]} <b>${fmtPv(cur.values[0])}</b></span><span>max <b>${fmtPv(maxV)}</b></span><span>Lv ${cur.levels[n - 1]} <b>${fmtPv(cur.values[n - 1])}</b></span></div>
  </div>`;
}
