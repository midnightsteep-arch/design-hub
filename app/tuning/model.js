// Tuning data helpers on top of repoStore: table families, sections, sorting, grouping, column text.
// Ported from tuning-desk/apps-script/App.html §4/§8 (rootOf, familyOf, sectionList, sortedRows, groupRows).
import { repoStore, schemaTable, tableRows, cellValue } from '../repo.js';
import { colEditable, isNumType, groupThousands, fmtPlain, itemTypeOf } from '../canon.js';

export const SEP = '\u0001';
export const cellId = (tid, key, cid) => tid + SEP + key + SEP + cid;
export const splitCellId = (id) => { const p = id.split(SEP); return { table: p[0], key: p[1], column: p[2] }; };
export const parentKeyOf = (key) => { const i = key.lastIndexOf('/'); return i < 0 ? '' : key.slice(0, i); };
export const lastNamePart = (name) => { const s = String(name || ''); const i = s.lastIndexOf(' › '); return i < 0 ? s : s.slice(i + 3); };
export const UNASSIGNED = 'Unassigned';
/** "6 enemies", "1 spell" – English plural of a schema noun (rowLabel). */
export function nounPlural(word) { const w = String(word || 'row'); return /[^aeiou]y$/i.test(w) ? w.slice(0, -1) + 'ies' : /(s|x|z|ch|sh)$/i.test(w) ? w + 'es' : w + 's'; }
export function countOf(n, word) { const w = word || 'row'; return `${Number(n).toLocaleString()} ${n === 1 ? w : nounPlural(w)}`; }
/** Route value for the empty section. */
export const NONE_Q = '(none)';

export function allTables() { const s = repoStore.get().schema; return (s && s.tables) || []; }
export function colOf(tid, cid) { const t = schemaTable(tid); return t ? t.columns.find((c) => c.id === cid) || null : null; }
export function rowOf(tid, key) { return tableRows(tid).find((r) => r.key === key) || null; }
export function rootOf(tid) {
  let t = schemaTable(tid);
  while (t && t.parent && schemaTable(t.parent)) t = schemaTable(t.parent);
  return t ? t.id : tid;
}
/** [rootId, child ids…] (breadth first). */
export function familyOf(rootId) {
  const out = [rootId], ts = allTables();
  for (let i = 0; i < out.length; i++) for (const t of ts) if (t.parent === out[i]) out.push(t.id);
  return out;
}
export const childTablesOf = (tid) => allTables().filter((t) => t.parent === tid);
export function tableLabel(tid) {
  const t = schemaTable(tid); if (!t) return tid;
  const r = schemaTable(rootOf(tid));
  return r && r !== t ? `${r.label || r.id} › ${t.label || t.id}` : (t.label || t.id);
}
/** Display name of a row (child rows: "Parent › item"). */
export function rowDisplayName(tid, row) { return row ? row.name || row.key : ''; }

// ------------------------------------------------------------- column text
export function rangeText(col) {
  const f = (n) => groupThousands(fmtPlain(n));
  if (col.min != null && col.max != null) return f(col.min) + ' – ' + f(col.max);
  if (col.min != null) return '≥ ' + f(col.min);
  if (col.max != null) return '≤ ' + f(col.max);
  return '';
}
export function typeText(col) {
  if (col.type === 'list') return 'List of ' + ({ int: 'whole numbers', float: 'numbers', bool: 'on/off values', string: 'lines', enum: 'options', color: 'colours' }[col.itemType || 'float'] || 'items');
  return ({ int: 'Whole number', float: 'Number', bool: 'On / off', string: col.multiline ? 'Long text' : 'Text', enum: 'One of ' + (col.options || []).length + ' options',
    flags: 'Any of ' + (col.options || []).length + ' options', color: 'Colour', vector2: 'Vector (x, y)', vector3: 'Vector (x, y, z)', vector4: 'Vector (x, y, z, w)', ref: 'Asset reference' })[col.type] || col.type;
}
/** Why a column can't be edited, or '' when it can. */
export function lockReason(col) {
  if (colEditable(col)) return '';
  if (col.computed) return 'Set by the engine (computed)';
  if (col.isKey) return 'Set by the engine (row key)';
  if (col.type === 'ref') return 'Set by the engine (asset reference)';
  return 'Set by the engine';
}
export const isRightAligned = (col) => col.type === 'int' || col.type === 'float';
export function defaultWidth(col) {
  switch (col.type) {
    case 'int': case 'float': return col.unit && col.unit.length > 2 ? 124 : 108;
    case 'bool': return 86;
    case 'enum': return 128;
    case 'flags': return 176;
    case 'color': return 124;
    case 'vector2': return 116; case 'vector3': return 144; case 'vector4': return 172;
    case 'list': return isNumType(itemTypeOf(col)) ? 140 : 210;
    case 'ref': return 190;
    case 'string': return col.multiline ? 240 : 168;
    default: return 140;
  }
}

// ------------------------------------------------------------- sections (Tuning Desk §10)
/** The root table that splits this table's family into sections, or null. */
export function sectionTable(tid) {
  const r = schemaTable(rootOf(tid));
  return r && r.sectionBy && r.columns.some((c) => c.id === r.sectionBy) ? r : null;
}
/** Section value of a row ('' = unassigned): the sectionBy value of its root row. cur(table,key,col) gives the value. */
export function sectionOfKey(tid, key, cur = cellValue) {
  const st = sectionTable(tid); if (!st) return null;
  const v = cur(st.id, key.split('/')[0], st.sectionBy);
  return v == null ? '' : String(v);
}
/** [{value, name, count}] in sectionOrder order (else alphabetical), unassigned last. Counts for tid's rows. */
export function sectionList(tid, cur = cellValue) {
  const st = sectionTable(tid); if (!st) return null;
  const counts = new Map();
  for (const r of tableRows(st.id)) { const s = sectionOfKey(st.id, r.key, cur); if (!counts.has(s)) counts.set(s, 0); }
  for (const r of tableRows(tid)) { const s = sectionOfKey(tid, r.key, cur); counts.set(s, (counts.get(s) || 0) + 1); }
  const order = st.sectionOrder || [];
  return [...counts.keys()].sort((a, b) => {
    if (a === '') return 1; if (b === '') return -1;
    const ia = order.indexOf(a), ib = order.indexOf(b);
    if (ia >= 0 || ib >= 0) return (ia < 0 ? 1e9 : ia) - (ib < 0 ? 1e9 : ib);
    return a.localeCompare(b);
  }).map((v) => ({ value: v, name: v || UNASSIGNED, count: counts.get(v) }));
}
export const sectionFromQuery = (s) => (s == null ? null : s === NONE_Q ? '' : s);
export const sectionToQuery = (v) => (v == null ? null : v === '' ? NONE_Q : v);

/** Rows in the default order (`sortBy`: numbers numeric, else text; ties by name). Uses saved values so rows don't jump. */
export function sortedRows(tid) {
  const t = schemaTable(tid), rows = tableRows(tid);
  const col = t && t.sortBy && t.columns.find((c) => c.id === t.sortBy);
  if (!col) return rows;
  const num = isNumType(col.type) || col.type === 'bool';
  const v = (r) => { const c = cellValue(tid, r.key, col.id); return num ? (c === 'true' ? 1 : c === 'false' ? 0 : Number(c) || 0) : String(c == null ? '' : c); };
  return rows.slice().sort((a, b) => { const x = v(a), y = v(b); const d = num ? x - y : x.localeCompare(y); return d || String(a.name).localeCompare(String(b.name)); });
}

/**
 * Group rows for display: by parent row (child tables), by section ("All" in a sectioned table), or null.
 * → [{key, label, rows, sec}]
 */
export function groupRows(tid, rows, section, cur = cellValue) {
  const t = schemaTable(tid);
  if (t && t.parent) {
    const groups = [], byP = new Map();
    for (const r of rows) { const pk = parentKeyOf(r.key); if (!byP.has(pk)) { byP.set(pk, []); groups.push(pk); } byP.get(pk).push(r); }
    return groups.map((pk) => {
      const prow = rowOf(t.parent, pk);
      return { key: pk, label: prow ? prow.name : String(byP.get(pk)[0].name).split(' › ').slice(0, -1).join(' › '), rows: byP.get(pk), parentKey: pk };
    });
  }
  if (sectionTable(tid) && section == null) {
    const byS = new Map();
    for (const r of rows) { const s = sectionOfKey(tid, r.key, cur); if (!byS.has(s)) byS.set(s, []); byS.get(s).push(r); }
    return sectionList(tid, cur).filter((s) => byS.has(s.value)).map((s) => ({ key: '§' + s.value, label: s.name, rows: byS.get(s.value), sec: true }));
  }
  return null;
}

/** Column groups in schema order. */
export function colGroupsOf(t) { const gs = []; for (const c of t.columns) if (c.group && !gs.includes(c.group)) gs.push(c.group); return gs; }

/** Card layout for a table (title/description/badges/footer + panels grouped by column group; ungrouped → "Details"). */
export function cardLayout(t) {
  const card = t.card || {}, vis = t.columns, ids = new Set(vis.map((c) => c.id));
  const ok = (id) => id && ids.has(id);
  const L = { title: ok(card.title) ? card.title : null, desc: null, badges: [], footer: [] };
  if (t.card) {
    L.desc = ok(card.description) ? card.description : null;
    L.badges = (card.badges || []).filter(ok);
    L.footer = (card.footer || []).filter(ok);
  } else {
    const ml = vis.find((c) => c.type === 'string' && c.multiline && colEditable(c));
    L.desc = ml ? ml.id : null;
    L.badges = vis.filter((c) => c.type === 'enum').slice(0, 2).map((c) => c.id);
  }
  const used = new Set([L.title, L.desc, ...L.badges, ...L.footer]);
  let groups = []; const byG = new Map();
  for (const c of vis) { if (used.has(c.id)) continue; const g = c.group || ''; if (!byG.has(g)) { byG.set(g, []); groups.push(g); } byG.get(g).push(c); }
  if (groups.includes('')) { groups = groups.filter((g) => g !== ''); groups.push(''); }
  const pvs = (t.previews || []).filter((p) => p && p.expr);
  L.panels = groups.map((g) => ({ name: g || 'Details', cols: byG.get(g), previews: pvs.filter((p) => (p.group || '') === g && g !== '') }));
  for (const p of pvs) if (!L.panels.some((pn) => pn.previews.includes(p))) L.panels.push({ name: p.group || p.label || 'Preview', cols: [], previews: [p] });
  return L;
}
