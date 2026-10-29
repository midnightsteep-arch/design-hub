// Shared helpers: htm binding, formatting, storage, small utilities.
import { h, Fragment, render, createContext } from '../vendor/preact.module.js';
import htm from '../vendor/htm.module.js';

export const html = htm.bind(h);
export { h, Fragment, render, createContext };

export const cx = (...a) => a.filter(Boolean).join(' ');

export const STATUSES = ['pending_review', 'needs_replacement', 'replaced', 'approved'];
export const STATUS = {
  pending_review: { key: 'pending_review', label: 'Pending Review', short: 'Pending', icon: 'clock', cls: 'pending', hotkey: 'P',
    meaning: 'New or changed; a designer must look at it.' },
  needs_replacement: { key: 'needs_replacement', label: 'Needs Replacement', short: 'Needs replacement', icon: 'alert', cls: 'needs', hotkey: 'X',
    meaning: 'Rejected; the notes say why. Waiting for a replacement to be supplied.' },
  replaced: { key: 'replaced', label: 'Replaced', short: 'Replaced', icon: 'swap', cls: 'replaced', hotkey: 'U',
    meaning: 'A replacement is attached. Claude must swap it into the game.' },
  approved: { key: 'approved', label: 'Approved', short: 'Approved', icon: 'check', cls: 'approved', hotkey: 'A',
    meaning: 'Signed off by a designer. No further work.' },
};

export const KIND_LABEL = { sprite: 'Sprite', ui: 'UI', text: 'Text', other: 'Other' };
export const KIND_ICON = { sprite: 'image', ui: 'layout', text: 'type', other: 'file' };

export function emptyCounts() {
  return { pending_review: 0, needs_replacement: 0, replaced: 0, approved: 0 };
}
export function sumCounts(c) {
  if (!c) return 0;
  return (c.pending_review || 0) + (c.needs_replacement || 0) + (c.replaced || 0) + (c.approved || 0);
}

// ---------- storage (never throws) ----------
export const storage = {
  get(key, fallback = null) {
    try {
      const v = localStorage.getItem(key);
      return v == null ? fallback : JSON.parse(v);
    } catch (e) { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* private mode */ }
  },
  remove(key) { try { localStorage.removeItem(key); } catch (e) { /* ignore */ } },
};

// ---------- time ----------
const RTF = typeof Intl !== 'undefined' && Intl.RelativeTimeFormat ? new Intl.RelativeTimeFormat('en', { numeric: 'auto', style: 'short' }) : null;
export function relTime(ms, now = Date.now()) {
  if (!ms) return '—';
  const d = (ms - now) / 1000;
  const a = Math.abs(d);
  if (a < 45) return 'just now';
  const units = [['minute', 60], ['hour', 3600], ['day', 86400], ['week', 604800], ['month', 2629800], ['year', 31557600]];
  let u = units[0];
  for (const x of units) if (a >= x[1] * 0.92) u = x;
  const v = Math.round(d / u[1]);
  if (RTF) return RTF.format(v, u[0]);
  return `${Math.abs(v)} ${u[0]}${Math.abs(v) === 1 ? '' : 's'} ${v < 0 ? 'ago' : 'from now'}`;
}
export function fullTime(ms) {
  if (!ms) return '';
  try {
    return new Date(ms).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch (e) { return new Date(ms).toISOString(); }
}
export function shortDate(ms) {
  if (!ms) return '';
  try { return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); } catch (e) { return ''; }
}

// ---------- numbers ----------
const NF = new Intl.NumberFormat('en-US');
export function fmtInt(n) { return n == null || isNaN(n) ? '—' : NF.format(Math.round(n)); }
export function fmtNum(n, decimals) {
  if (n == null || n === '' || isNaN(Number(n))) return n == null ? '' : String(n);
  const x = Number(n);
  if (decimals == null) {
    return new Intl.NumberFormat('en-US', { maximumFractionDigits: Math.abs(x) < 10 ? 3 : 2 }).format(x);
  }
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(x);
}
// Compact number suffixes: K, M, B, T by default; a project can supply its own ladder
// (settings.numberSuffixes, e.g. ["K","M","B","T","Qa","Qi","Sx",…]). Past the last suffix → scientific.
const DEFAULT_SUFFIXES = ['K', 'M', 'B', 'T'];
let SUFFIXES = DEFAULT_SUFFIXES;
export function setNumberSuffixes(list) {
  SUFFIXES = Array.isArray(list) && list.length && list.every((s) => typeof s === 'string' && s) ? list.slice(0, 40) : DEFAULT_SUFFIXES;
}
export function numberSuffixes() { return SUFFIXES; }
export function fmtSci(x, digits = 2) {
  const [m, e] = Number(x).toExponential(digits).split('e');
  return `${String(parseFloat(m))}e${Number(e)}`;
}
export function fmtCompact(n, decimals = 1) {
  if (n == null || n === '' || isNaN(Number(n))) return n == null ? '' : String(n);
  const x = Number(n);
  const a = Math.abs(x);
  if (!isFinite(x)) return String(x);
  if (a < 1000) return fmtNum(x, Number.isInteger(x) ? 0 : undefined);
  let tier = Math.floor(Math.log10(a) / 3);
  let q = x / Math.pow(10, tier * 3);
  let r = Math.abs(q) >= 100 ? Math.round(q) : +q.toFixed(decimals);
  if (Math.abs(r) >= 1000) { tier += 1; q = x / Math.pow(10, tier * 3); r = +q.toFixed(decimals); }
  if (tier <= SUFFIXES.length) return String(r) + SUFFIXES[tier - 1];
  return fmtSci(x, 2);
}
export function suffixMultiplier(s) {
  const i = SUFFIXES.findIndex((x) => x.toLowerCase() === String(s).toLowerCase());
  return i >= 0 ? Math.pow(10, (i + 1) * 3) : null;
}
export function fmtDuration(sec) {
  if (sec == null || isNaN(Number(sec))) return sec == null ? '' : String(sec);
  let s = Number(sec);
  const neg = s < 0; s = Math.abs(s);
  let out;
  if (s < 60) out = (Number.isInteger(s) ? s : s.toFixed(1)) + 's';
  else if (s < 3600) out = `${Math.floor(s / 60)}m ${String(Math.round(s % 60)).padStart(2, '0')}s`;
  else out = `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m`;
  return (neg ? '−' : '') + out;
}
export function fmtBytes(n) {
  if (n == null) return '';
  if (n < 1024) return n + ' B';
  if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1048576).toFixed(1) + ' MB';
}
export function plural(n, one, many) { return `${fmtInt(n)} ${n === 1 ? one : (many || one + 's')}`; }

// ---------- misc ----------
export function debounce(fn, ms) {
  let t;
  const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  d.cancel = () => clearTimeout(t);
  return d;
}
export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export function slugify(s) {
  return String(s || '').toLowerCase().trim()
    .replace(/<[^>]+>/g, '').replace(/[^\p{L}\p{N}\s-]/gu, '').replace(/\s+/g, '-').replace(/-+/g, '-').slice(0, 80) || 'section';
}
export function fileUrl(hash) { return hash ? `/api/files/${encodeURIComponent(hash)}` : ''; }
export function initials(name) {
  const s = String(name || '?').replace(/@.*/, '').split(/[ ._()-]+/).map((w) => w.replace(/[^\p{L}\p{N}]/gu, '')).filter(Boolean);
  return ((s[0] || '?')[0] + (s[1] ? s[1][0] : '')).toUpperCase();
}
export function displayName(actor) {
  if (!actor) return 'Someone';
  if (actor.startsWith('bot:')) return 'Claude';
  return actor;
}
export function shortActor(actor) {
  if (!actor) return 'someone';
  if (actor.startsWith('bot:') || actor === 'Claude') return 'Claude';
  const at = actor.indexOf('@');
  return at > 0 ? actor.slice(0, at) : actor;
}
export function isBotActor(actor) {
  return !!actor && (actor.startsWith('bot:') || actor === 'Claude' || actor.toLowerCase() === 'claude');
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (e) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch (e2) { return false; }
  }
}

export function isTypingTarget(el) {
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
export const modKey = isMac ? '⌘' : 'Ctrl';

export function uniq(arr) { return Array.from(new Set(arr)); }
export function byKey(arr, key = 'id') {
  const m = new Map();
  for (const x of arr || []) m.set(x[key], x);
  return m;
}
export function truncate(s, n) {
  s = String(s ?? '');
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}
export function onlyDigitsish(v) { return typeof v === 'number' || (typeof v === 'string' && v.trim() !== '' && !isNaN(Number(v))); }
