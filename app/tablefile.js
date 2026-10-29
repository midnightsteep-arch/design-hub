// Tuning table files (contract §5): deterministic serialisation, parsing, cell-by-cell re-apply (§8).
// Pure module (browser + node).
import { canon, canonValue, defaultCanon } from './canon.js';

/** Ordinal byte-order compare of two strings (UTF-8 byte order == code point order). */
export function compareOrdinal(a, b) {
  if (a === b) return 0;
  const ia = a[Symbol.iterator](), ib = b[Symbol.iterator]();
  for (;;) {
    const x = ia.next(), y = ib.next();
    if (x.done) return y.done ? 0 : -1;
    if (y.done) return 1;
    const ca = x.value.codePointAt(0), cb = y.value.codePointAt(0);
    if (ca !== cb) return ca < cb ? -1 : 1;
  }
}

/**
 * Serialise a table file byte-exactly (§5).
 * @param {string} tableId
 * @param {Array<{key:string,name?:string,values:Object}>} rows
 * @param {{columns:Array<{id:string}>}|null} schemaTable  column order; values for columns not in the schema are dropped
 *        (contract §5). Without a schema table, values keep their existing order.
 */
export function serializeTable(tableId, rows, schemaTable) {
  const order = schemaTable && Array.isArray(schemaTable.columns) ? schemaTable.columns.map((c) => c.id) : [];
  const sorted = [...(rows || [])].sort((a, b) => compareOrdinal(String(a.key), String(b.key)));
  const lines = sorted.map((r) => {
    const src = r.values || {};
    const values = {};
    const ids = schemaTable ? order : Object.keys(src);
    for (const id of ids) if (src[id] !== undefined && src[id] !== null) values[id] = String(src[id]);
    const o = { key: String(r.key) };
    if (r.name !== undefined && r.name !== null) o.name = String(r.name);
    o.values = values;
    return '    ' + JSON.stringify(o);
  });
  const head = '{\n  "table": ' + JSON.stringify(String(tableId)) + ',\n';
  if (!lines.length) return head + '  "rows": []\n}\n';
  return head + '  "rows": [\n' + lines.join(',\n') + '\n  ]\n}\n';
}

/** Parse a table file's text → {table, rows}. Throws on malformed JSON. */
export function parseTable(text) {
  const j = JSON.parse(text);
  if (!j || typeof j !== 'object' || !Array.isArray(j.rows)) throw new Error('Not a tuning table file (no "rows" array)');
  return { table: j.table, rows: j.rows.map((r) => ({ key: String(r.key), name: r.name, values: { ...(r.values || {}) } })) };
}

/** Current canonical value of a cell in parsed table data (absent → type default, as Tuning Desk §4). */
export function cellCanon(data, col, key) {
  const row = data && data.rows.find((r) => r.key === key);
  if (!row) return null;
  const raw = row.values[col.id];
  if (raw === undefined || raw === null) return defaultCanon(col.type);
  const c = canon(col, raw);
  return c === null ? String(raw) : c; // invalid → compare raw text
}

/**
 * Re-apply the user's changes onto freshly read table data, cell by cell (§8).
 * changes: [{table, key, column, from, to}] (canonical strings); all for this table.
 * Returns {data, applied:[…], conflicts:[{…change, current}], missing:[…]}; data is a new object.
 * A change applies when the cell's current canonical value equals `from`; if it already equals `to`
 * it counts as applied (no-op). Anything else is a conflict and is NOT written.
 */
export function reapplyChanges(data, schemaTable, changes) {
  const out = { table: data.table, rows: data.rows.map((r) => ({ key: r.key, name: r.name, values: { ...r.values } })) };
  const colById = new Map((schemaTable.columns || []).map((c) => [c.id, c]));
  const applied = [], conflicts = [], missing = [];
  for (const ch of changes) {
    const col = colById.get(ch.column);
    const row = out.rows.find((r) => r.key === ch.key);
    if (!col || !row) { missing.push(ch); continue; }
    const cur = cellCanon(out, col, ch.key);
    if (cur === ch.to) { applied.push({ ...ch, noop: true }); continue; }
    if (cur !== ch.from) { conflicts.push({ ...ch, current: cur }); continue; }
    row.values[ch.column] = ch.to;
    applied.push(ch);
  }
  return { data: out, applied, conflicts, missing };
}

/** Apply changes unconditionally (used after the user resolved conflicts). */
export function forceChanges(data, changes) {
  const out = { table: data.table, rows: data.rows.map((r) => ({ key: r.key, name: r.name, values: { ...r.values } })) };
  for (const ch of changes) {
    const row = out.rows.find((r) => r.key === ch.key);
    if (row) row.values[ch.column] = ch.to;
  }
  return out;
}

export { canonValue };
