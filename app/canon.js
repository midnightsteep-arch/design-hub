// Canonical form (contract §5, Tuning Desk §4) + designer input parsing + display text.
// Pure module: no DOM, runs in the browser and in node (tests).
// The core block below is ported from tuning-desk/apps-script/App.html (verbatim Code.gs block),
// extended with float precision 64 (Godot) and int vector items.

export const VECTOR_LEN = { vector2: 2, vector3: 3, vector4: 4 };
const LIST_ITEM_TYPES = { int: 1, float: 1, bool: 1, string: 1, enum: 1, color: 1 };

// float32: shortest decimal that round-trips to the same float32 (Tuning Desk canonFloat, byte-identical).
export function canonFloat(v) {
  var x = Math.fround(Number(v));
  if (!isFinite(x)) return null;
  if (x === 0) return '0';
  for (var p = 1; p <= 9; p++) {
    var y = parseFloat(x.toPrecision(p));
    if (Math.fround(y) === x) return String(y);
  }
  return String(x);
}

// float64: JS Number.prototype.toString of the double; -0 → "0".
export function canonFloat64(v) {
  var x = Number(v);
  if (!isFinite(x)) return null;
  if (x === 0) return '0';
  return String(x);
}

export function precisionOf(col) { return col && Number(col.precision) === 64 ? 64 : 32; }
export function canonFloatP(v, precision) { return precision === 64 ? canonFloat64(v) : canonFloat(v); }

const NUMBER_TEXT_RE = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
function parseNumber(v) {
  if (typeof v === 'number') return isFinite(v) ? v : NaN;
  if (typeof v === 'string') { const s = v.trim(); return NUMBER_TEXT_RE.test(s) ? Number(s) : NaN; }
  return NaN;
}
function cellText(v) { return v === null || v === undefined ? '' : String(v); }
function canonText(v) { return cellText(v).replace(/\r\n/g, '\n'); }
function canonInt(v) {
  const n = parseNumber(v);
  if (!isFinite(n) || Math.floor(n) !== n || !Number.isSafeInteger(n)) return null;
  return String(n === 0 ? 0 : n);
}
function canonFloatValue(v, precision) {
  const n = parseNumber(v);
  return isNaN(n) ? null : canonFloatP(n, precision);
}
function canonBool(v) {
  if (v === true || v === false) return String(v);
  if (typeof v === 'string') { const s = v.trim().toLowerCase(); if (s === 'true' || s === 'false') return s; }
  return null;
}
function canonColorStrict(v) {
  if (typeof v !== 'string') return null;
  const m = /^#?([0-9a-fA-F]{6})([0-9a-fA-F]{2})?$/.exec(v.trim());
  return m ? ('#' + m[1] + (m[2] || 'FF')).toUpperCase() : null;
}
function matchOption(name, options) {
  if (!options || !options.length) return name;
  if (options.indexOf(name) >= 0) return name;
  const lower = name.toLowerCase();
  for (const o of options) if (String(o).toLowerCase() === lower) return o;
  return null;
}
function canonEnum(v, options) {
  if (typeof v !== 'string' && typeof v !== 'number') return null;
  const s = canonText(v).trim();
  if (s === '') return '';
  return matchOption(s, options);
}
function canonFlags(v, options) {
  if (typeof v !== 'string') return null;
  if (!options || !options.length) return null;
  const parts = v.split('|').map((p) => p.trim()).filter((p) => p !== '');
  const picked = {};
  for (const p of parts) { const m = matchOption(p, options); if (m === null) return null; picked[m] = true; }
  return options.filter((o) => picked[o]).join('|');
}
function parseArrayValue(v) {
  if (Array.isArray(v)) return v;
  if (typeof v !== 'string') return null;
  let s = v.trim();
  if (s === '') return [];
  if (s.charAt(0) !== '[') s = '[' + s + ']';
  let parsed;
  try { parsed = JSON.parse(s); } catch (err) { return null; }
  return Array.isArray(parsed) ? parsed : null;
}
export function formatList(items) { return '[' + items.join(', ') + ']'; }

function canonListItem(itemType, item, options, precision) {
  switch (itemType) {
    case 'int': return typeof item === 'boolean' ? null : canonInt(item);
    case 'float': return typeof item === 'boolean' ? null : canonFloatValue(item, precision);
    case 'bool': return canonBool(item);
    case 'string':
      if (typeof item !== 'string' && typeof item !== 'number') return null;
      return JSON.stringify(canonText(item));
    case 'enum': { const e = canonEnum(item, options); return e === null || e === '' ? null : JSON.stringify(e); }
    case 'color': { const c = canonColorStrict(item); return c === null ? null : JSON.stringify(c); }
  }
  return null;
}

export function defaultCanon(colType) {
  switch (colType) {
    case 'int': case 'float': return '0';
    case 'bool': return 'false';
    case 'color': return '#00000000';
    case 'list': return '[]';
    case 'vector2': case 'vector3': case 'vector4': {
      const z = []; for (let i = 0; i < VECTOR_LEN[colType]; i++) z.push('0');
      return formatList(z);
    }
    default: return '';
  }
}

/** Canonical string of a value for a column → {ok, canon} | {ok:false, error}. Empty/null → type default. */
export function canonValue(colType, value, column) {
  column = column || {};
  const prec = precisionOf(column);
  if (value === null || value === undefined || value === '') return { ok: true, canon: defaultCanon(colType) };
  let c = null, why = '';
  switch (colType) {
    case 'int': c = canonInt(value); why = 'not an integer'; break;
    case 'float': c = canonFloatValue(value, prec); why = 'not a number'; break;
    case 'bool': c = canonBool(value); why = 'not true/false'; break;
    case 'string': case 'ref': c = canonText(value); break;
    case 'enum': c = canonEnum(value, column.options); why = 'not one of: ' + (column.options || []).join(', '); break;
    case 'flags': c = canonFlags(cellText(value), column.options); why = 'not a "|"-separated subset of: ' + (column.options || []).join(', '); break;
    case 'color': c = canonColorStrict(cellText(value)); why = 'not a #RRGGBB or #RRGGBBAA color'; break;
    case 'vector2': case 'vector3': case 'vector4': {
      const vec = parseArrayValue(value), n = VECTOR_LEN[colType];
      const it = column.itemType === 'int' ? 'int' : 'float';
      why = 'not a JSON array of ' + n + ' numbers';
      if (vec && vec.length === n) {
        const parts = vec.map((x) => (typeof x === 'boolean' ? null : it === 'int' ? canonInt(x) : canonFloatValue(x, prec)));
        if (parts.indexOf(null) < 0) c = formatList(parts);
      }
      break;
    }
    case 'list': {
      const itemType = column.itemType;
      if (!LIST_ITEM_TYPES[itemType]) return { ok: false, error: 'list column has unsupported itemType "' + itemType + '"' };
      const arr = parseArrayValue(value);
      why = 'not a JSON array of ' + itemType + ' items';
      if (arr) {
        const items = arr.map((x) => (x === null || x === undefined ? null : canonListItem(itemType, x, column.options, prec)));
        if (items.indexOf(null) < 0) c = formatList(items);
      }
      break;
    }
    default: return { ok: false, error: 'unknown column type "' + colType + '"' };
  }
  return c === null ? { ok: false, error: why } : { ok: true, canon: c };
}

// ------------------------------------------------------------- app-side helpers
export const vecLen = (type) => VECTOR_LEN[type] || -1;
export const isListy = (col) => col.type === 'list' || vecLen(col.type) > 0;
export const itemTypeOf = (col) => (col.type === 'list' ? (col.itemType || 'float') : (col.itemType === 'int' ? 'int' : 'float'));
export const isNumType = (t) => t === 'int' || t === 'float';
/** Canonical string, or null when invalid. */
export function canon(col, v) { const r = canonValue(col.type, v, col); return r.ok ? r.canon : null; }
export function canonError(col, v) { const r = canonValue(col.type, v, col); return r.ok ? '' : r.error; }
export function canonColor(v) { const s = String(v == null ? '' : v).trim(); return s === '' ? '' : canonColorStrict(s); }
export function canonNumber(v, isInt, precision) { return isInt ? canonInt(v) : canonFloatValue(v, precision || 32); }
export function canonArray(col, arr) {
  const it = itemTypeOf(col), out = [], prec = precisionOf(col);
  for (const x of arr) { const c = x == null ? null : canonListItem(it, x, col.options, prec); if (c === null) return null; out.push(c); }
  return formatList(out);
}
export function listItems(s) { try { const a = JSON.parse(s); return Array.isArray(a) ? a : null; } catch (e) { return null; } }
export const colEditable = (col) => !col.readOnly && !col.isKey && col.type !== 'ref' && !col.computed;

/* tiny arithmetic so designers can type "250*1.1" or "1200/4" */
export function evalExpr(src) {
  const s = src.replace(/\s+/g, ''); let i = 0;
  function num() { const m = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(s.slice(i)); if (!m) throw 0; i += m[0].length; return parseFloat(m[0]); }
  function atom() {
    if (s[i] === '-') { i++; return -atom(); }
    if (s[i] === '+') { i++; return atom(); }
    if (s[i] === '(') { i++; const v = add(); if (s[i] !== ')') throw 0; i++; return v; }
    return num();
  }
  function mul() { let v = atom(); while (s[i] === '*' || s[i] === '/') { const o = s[i++], r = atom(); v = o === '*' ? v * r : v / r; } return v; }
  function add() { let v = mul(); while (s[i] === '+' || s[i] === '-') { const o = s[i++], r = mul(); v = o === '+' ? v + r : v - r; } return v; }
  const v = add(); if (i !== s.length) throw 0; return v;
}
export function fmtPlain(n, precision) { return canonFloatP(n, precision || 64) || String(n); }

export function parseNumberText(text, col, isInt) {
  let s = String(text == null ? '' : text).trim();
  if (col && col.unit && s.slice(-col.unit.length) === col.unit) s = s.slice(0, -col.unit.length).trim();
  s = s.replace(/^=/, '').replace(/(\d),(?=\d{3}\b)/g, '$1').replace(/_/g, '').replace(/^−/, '-');
  if (s === '') return { ok: false, error: 'Enter a number' };
  let n = Number(s);
  if (!isFinite(n)) { try { n = evalExpr(s); } catch (e) { return { ok: false, error: 'Not a number' }; } }
  if (!isFinite(n)) return { ok: false, error: 'Not a number' };
  if (isInt && !Number.isInteger(n)) return { ok: false, error: 'Whole numbers only' };
  if (!isInt && precisionOf(col) === 32 && !isFinite(Math.fround(n))) return { ok: false, error: 'Too large' };
  if (isInt && Math.abs(n) > 2147483647 && precisionOf(col) !== 64) return { ok: false, error: 'Too large for an int' };
  if (col && col.min != null && n < col.min) return { ok: false, error: 'Minimum is ' + fmtPlain(col.min) };
  if (col && col.max != null && n > col.max) return { ok: false, error: 'Maximum is ' + fmtPlain(col.max) };
  return { ok: true, value: n };
}

function splitLoose(s, itemType) {
  if (s === '') return [];
  if (isNumType(itemType) || itemType === 'bool') return s.split(/[\n\t,;]+|\s+/).filter((x) => x.trim() !== '');
  return s.replace(/\r\n/g, '\n').split('\n').filter((x, i, a) => !(x === '' && i === a.length - 1));
}
export function parseItems(col, arr) {
  const it = itemTypeOf(col), n = vecLen(col.type), out = [];
  if (!Array.isArray(arr)) return { ok: false, error: 'Not a list' };
  if (n > 0 && arr.length !== n) return { ok: false, error: 'Needs exactly ' + n + ' values' };
  for (let i = 0; i < arr.length; i++) {
    const v = arr[i];
    if (isNumType(it)) {
      let r = typeof v === 'number' ? (it === 'int' && !Number.isInteger(v) ? { ok: false, error: 'Whole numbers only' } : { ok: true, value: v }) : parseNumberText(v, { precision: col.precision }, it === 'int');
      if (r.ok && col.type === 'list' && col.min != null && r.value < col.min) r = { ok: false, error: 'Minimum is ' + fmtPlain(col.min) };
      if (r.ok && col.type === 'list' && col.max != null && r.value > col.max) r = { ok: false, error: 'Maximum is ' + fmtPlain(col.max) };
      if (!r.ok) return { ok: false, error: (n > 0 ? 'xyzw'.charAt(i).toUpperCase() : 'Item ' + (i + 1)) + ': ' + r.error, index: i };
      out.push(r.value);
    } else if (it === 'bool') {
      const b = typeof v === 'boolean' ? v : /^(true|yes|on|1)$/i.test(String(v).trim()) ? true : /^(false|no|off|0)$/i.test(String(v).trim()) ? false : null;
      if (b === null) return { ok: false, error: 'Item ' + (i + 1) + ': use true/false', index: i };
      out.push(b);
    } else if (it === 'enum') {
      const o = (col.options || []).find((x) => x.toLowerCase() === String(v).trim().toLowerCase());
      if (o === undefined) return { ok: false, error: 'Item ' + (i + 1) + ': not one of ' + (col.options || []).join(', '), index: i };
      out.push(o);
    } else if (it === 'color') {
      const c = canonColor(v); if (!c) return { ok: false, error: 'Item ' + (i + 1) + ': use #RRGGBB', index: i };
      out.push(c);
    } else out.push(String(v).replace(/\r\n/g, '\n'));
  }
  const cv = canonArray(col, out);
  return cv === null ? { ok: false, error: 'Invalid list' } : { ok: true, value: cv };
}

/** Designer-typed text → canonical string for a column → {ok, value} | {ok:false, error}. */
export function parseInput(col, text) {
  const t = col.type, s = String(text == null ? '' : text);
  if (t === 'int' || t === 'float') {
    const r = parseNumberText(s, col, t === 'int'); if (!r.ok) return r;
    return { ok: true, value: canonNumber(r.value, t === 'int', precisionOf(col)) };
  }
  if (t === 'bool') {
    const b = s.trim().toLowerCase();
    if (/^(true|yes|on|1|y|x|✓)$/.test(b)) return { ok: true, value: 'true' };
    if (/^(false|no|off|0|n|)$/.test(b)) return { ok: true, value: 'false' };
    return { ok: false, error: 'Use true or false' };
  }
  if (t === 'string') return { ok: true, value: s.replace(/\r\n/g, '\n') };
  if (t === 'enum') {
    const o = (col.options || []).find((x) => x.toLowerCase() === s.trim().toLowerCase());
    return o !== undefined ? { ok: true, value: o } : { ok: false, error: 'Pick one of: ' + (col.options || []).join(', ') };
  }
  if (t === 'flags') {
    const parts = s.split(/[|,]/).map((p) => p.trim().toLowerCase()).filter(Boolean);
    const opts = col.options || [];
    const bad = parts.filter((p) => !opts.some((x) => x.toLowerCase() === p));
    if (bad.length) return { ok: false, error: 'Unknown: ' + bad.join(', ') };
    return { ok: true, value: opts.filter((x) => parts.indexOf(x.toLowerCase()) >= 0).join('|') };
  }
  if (t === 'color') {
    const c = canonColor(s);
    return c === null || c === '' ? { ok: false, error: 'Use #RRGGBB or #RRGGBBAA' } : { ok: true, value: c };
  }
  if (t === 'ref') return { ok: false, error: 'References are set in the engine' };
  if (isListy(col)) {
    let arr; const trimmed = s.trim();
    if (trimmed.charAt(0) === '[') { try { arr = JSON.parse(trimmed); } catch (e) { return { ok: false, error: 'Not a valid list' }; } }
    else arr = splitLoose(trimmed, itemTypeOf(col));
    return parseItems(col, arr);
  }
  return { ok: true, value: s };
}

/** Validate an already-canonical candidate value for a column before commit (§8). */
export function validateCanon(col, cv) {
  if (!colEditable(col)) return { ok: false, error: 'This column is read-only (owned by the engine)' };
  const r = canonValue(col.type, cv, col);
  if (!r.ok) return { ok: false, error: r.error };
  if (isNumType(col.type)) {
    const n = Number(r.canon);
    if (col.min != null && n < col.min) return { ok: false, error: 'Minimum is ' + fmtPlain(col.min) };
    if (col.max != null && n > col.max) return { ok: false, error: 'Maximum is ' + fmtPlain(col.max) };
  }
  if (col.type === 'enum' && col.options && col.options.length && r.canon !== '' && col.options.indexOf(r.canon) < 0) return { ok: false, error: 'Not one of the options' };
  return { ok: true, canon: r.canon };
}

export function editText(col, cv) {
  if (vecLen(col.type) > 0) { const a = listItems(cv); return a ? a.join(', ') : cv; }
  return cv;
}

// ------------------------------------------------------------- display
export function groupThousands(s) {
  s = String(s);
  if (/e/i.test(s)) return s;
  const neg = s.charAt(0) === '-'; if (neg) s = s.slice(1);
  const p = s.split('.'); let ip = p[0];
  if (ip.length > 3) ip = ip.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (neg ? '−' : '') + ip + (p.length > 1 ? '.' + p[1] : '');
}
const plural = (n, one, many) => n + ' ' + (n === 1 ? one : (many || one + 's'));
/** Compact human text for a canonical value (review, tooltips, history). */
export function displayText(col, cv, max) {
  max = max || 60;
  if (cv === null || cv === undefined) return '—';
  const t = col.type; let out;
  if (t === 'int' || t === 'float') out = groupThousands(cv) + (col.unit ? (col.unit === '%' ? '%' : ' ' + col.unit) : '');
  else if (t === 'bool') out = cv === 'true' ? 'On' : 'Off';
  else if (t === 'flags') out = cv === '' ? 'None' : cv.split('|').join(', ');
  else if (isListy(col)) {
    const a = listItems(cv);
    if (!a) out = cv;
    else if (vecLen(t) > 0) out = '(' + a.map((x) => groupThousands(fmtPlain(x))).join(', ') + ')';
    else if (!a.length) out = 'Empty list';
    else if (isNumType(itemTypeOf(col))) out = a.length + ' values · ' + a.slice(0, 4).map((x) => groupThousands(fmtPlain(x))).join(', ') + (a.length > 4 ? '…' : '');
    else out = plural(a.length, itemTypeOf(col) === 'string' ? 'line' : 'item') + ' · ' + String(a[0]).split('\n')[0];
  } else if (t === 'string' || t === 'enum' || t === 'ref') out = cv === '' ? '(empty)' : cv.replace(/\n/g, ' ⏎ ');
  else out = cv;
  return out.length > max ? out.slice(0, max - 1) + '…' : out;
}

export function defaultStep(col, v) {
  if (col.step) return col.step;
  if (col.type === 'int') return 1;
  const m = Math.abs(Number(v)) || 0;
  if (m === 0) return 0.01;
  return Math.pow(10, Math.floor(Math.log10(m)) - 2);
}
function roundToStep(v, step) {
  const d = Math.max(0, Math.min(9, -Math.floor(Math.log10(step)) + 1));
  return Number(v.toFixed(d));
}
export function nudge(col, cv, dir, big) {
  let v = Number(cv); if (!isFinite(v)) v = 0;
  const st = defaultStep(col, v) * (big ? 10 : 1);
  let n = roundToStep(v + dir * st, st);
  if (col.type === 'int') n = Math.round(n);
  if (col.min != null) n = Math.max(col.min, n);
  if (col.max != null) n = Math.min(col.max, n);
  return canonNumber(n, col.type === 'int', precisionOf(col));
}
