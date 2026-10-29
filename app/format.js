// Data-table cell formatting for read-only views (contract §6 column types), chart axis labels.
import { fmtNum, fmtCompact, fmtDuration, suffixMultiplier } from './lib.js';

export const NUMERIC = new Set(['number', 'int', 'percent', 'multiplier', 'currency', 'duration']);
export const PROPOSABLE = new Set(['number', 'int', 'percent', 'multiplier', 'currency', 'duration', 'text', 'tag', 'bool']);

export function isNumericCol(col) { return col && NUMERIC.has(col.type || 'text'); }

export function toNumber(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return isFinite(v) ? v : null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  const n = Number(String(v).replace(/[,_\s]/g, ''));
  return isFinite(n) ? n : null;
}

// Plain-text formatted value (no units markup).
export function formatCell(col, v) {
  if (v == null || v === '') return '';
  const t = (col && col.type) || 'text';
  const d = col && col.decimals;
  const unit = col && col.unit ? ' ' + col.unit : '';
  const compact = col && col.format === 'compact';
  const n = toNumber(v);
  switch (t) {
    case 'number':
      if (n == null) return String(v);
      return (compact ? fmtCompact(n, d ?? 1) : fmtNum(n, d)) + unit;
    case 'int':
      if (n == null) return String(v);
      return (compact ? fmtCompact(n, d ?? 1) : fmtNum(Math.round(n), 0)) + unit;
    case 'currency':
      if (n == null) return String(v);
      return (compact ? fmtCompact(n, d ?? 1) : fmtNum(n, d ?? (Number.isInteger(n) ? 0 : 2))) + unit;
    case 'percent':
      if (n == null) return String(v);
      return fmtNum(n * 100, d ?? (Number.isInteger(n * 100) ? 0 : 1)) + '%';
    case 'multiplier':
      if (n == null) return String(v);
      return '×' + fmtNum(n, d ?? 2);
    case 'duration':
      if (n == null) return String(v);
      return fmtDuration(n);
    case 'bool':
      return v === true || v === 1 || v === 'true' || v === '1' ? 'Yes' : 'No';
    default:
      return String(v) + (t === 'text' && unit && typeof v === 'number' ? unit : '');
  }
}

// Short label for chart axes.
export function formatAxis(col, v, compact) {
  const t = (col && col.type) || 'number';
  if (t === 'percent') return fmtNum(v * 100, 0) + '%';
  if (t === 'multiplier') return '×' + fmtNum(v, Math.abs(v) < 10 ? 1 : 0);
  if (t === 'duration') return fmtDuration(v);
  if (compact || Math.abs(v) >= 10000) return fmtCompact(v, 1);
  return fmtNum(v, Math.abs(v) < 1 && v !== 0 ? 2 : Math.abs(v) < 10 && !Number.isInteger(v) ? 1 : 0);
}

// Parse what a designer typed into the proposal box, in the column's display units.
export function parseProposed(col, str) {
  const t = (col && col.type) || 'text';
  const s = String(str ?? '').trim();
  if (!s) return { ok: false, error: 'Enter a value' };
  if (t === 'text' || t === 'tag') return { ok: true, value: s };
  if (t === 'bool') {
    const l = s.toLowerCase();
    if (['yes', 'true', '1', 'on', 'y'].includes(l)) return { ok: true, value: true };
    if (['no', 'false', '0', 'off', 'n'].includes(l)) return { ok: true, value: false };
    return { ok: false, error: 'Use yes or no' };
  }
  if (t === 'duration') {
    const m = /^(?:(\d+(?:\.\d+)?)h)?\s*(?:(\d+(?:\.\d+)?)m)?\s*(?:(\d+(?:\.\d+)?)s?)?$/i.exec(s.replace(/\s+/g, ' '));
    if (m && (m[1] || m[2] || m[3])) {
      const v = (Number(m[1] || 0) * 3600) + (Number(m[2] || 0) * 60) + Number(m[3] || 0);
      return { ok: true, value: v };
    }
    return { ok: false, error: 'Use seconds, or e.g. 1m 30s' };
  }
  let x = s.replace(/[,_\s]/g, '').replace(/^[×x*]/i, '');
  let mult = 1;
  if (t === 'percent') {
    if (x.endsWith('%')) { x = x.slice(0, -1); mult = 0.01; }
    else mult = 0.01; // typed in display units (25 = 25%)
  }
  const suf = /^(-?\d+(?:\.\d+)?)([a-z]{1,3})$/i.exec(x);
  if (suf && !/^e$/i.test(suf[2])) {
    const mult = suffixMultiplier(suf[2]);
    if (mult) x = String(Number(suf[1]) * mult);
  }
  if (col && col.unit && x.toLowerCase().endsWith(col.unit.toLowerCase())) x = x.slice(0, -col.unit.length);
  const n = Number(x);
  if (!isFinite(n)) return { ok: false, error: 'Enter a number' };
  let v = n * mult;
  if (t === 'int') v = Math.round(v);
  v = Math.round(v * 1e9) / 1e9;
  return { ok: true, value: v };
}

// Value in the units the designer types (inverse of parseProposed) — prefills the proposal box.
export function editableValue(col, v) {
  const t = (col && col.type) || 'text';
  if (v == null) return '';
  if (t === 'percent') { const n = toNumber(v); return n == null ? String(v) : String(Math.round(n * 100 * 1e6) / 1e6); }
  if (t === 'bool') return formatCell(col, v).toLowerCase();
  if (t === 'duration') { const n = toNumber(v); return n == null ? String(v) : String(n); }
  return String(v);
}

export function deltaInfo(col, from, to) {
  const a = toNumber(from), b = toNumber(to);
  if (a == null || b == null || !isNumericCol(col)) return null;
  const diff = b - a;
  const pct = a !== 0 ? (diff / Math.abs(a)) * 100 : null;
  return { diff, pct, up: diff > 0, down: diff < 0 };
}
