// Commit message format (contract §8) — build and parse. Pure module.
// Reference implementation: design-hub/cli/hublib/gitlog.py (must match it).
//
//   hub: <summary>
//
//   EnemyDef|b8x1k2…|hp: 45 → 52
//   asset|forest-enemies|texture:abc: pending_review → approved
//   page|pitch: edited
//   Note: <the user's note, if any>
//
//   Hub-Source: app
//
// Values: an absent cell is written ∅; a value is JSON-quoted when it is empty, has leading/trailing
// whitespace, contains a newline/CR or "→", or starts with '"' or "∅"; otherwise plain text.

export const ABSENT = '∅';
const ARROW = ' → ';

export function encodeValue(v) {
  if (v === null || v === undefined) return ABSENT;
  const s = String(v);
  const simple = s !== '' && s === s.trim() && !/[\r\n]/.test(s) && !s.includes('→') && !s.startsWith('"') && !s.startsWith(ABSENT);
  return simple ? s : JSON.stringify(s);
}
/** Take one value from the start of s → [value, rest] (value null for ∅). Mirrors gitlog.py _take_value. */
function takeValue(s) {
  if (s.startsWith('"')) {
    let i = 1;
    for (; i < s.length; i++) { if (s[i] === '\\') { i++; continue; } if (s[i] === '"') break; }
    if (i < s.length) {
      try { const v = JSON.parse(s.slice(0, i + 1)); if (typeof v === 'string') return [v, s.slice(i + 1)]; } catch (e) { /* plain */ }
    }
  }
  if (s.startsWith(ABSENT) && (s.length === ABSENT.length || s.slice(ABSENT.length).startsWith(' '))) return [null, s.slice(ABSENT.length)];
  const k = s.indexOf(ARROW);
  return k < 0 ? [s, ''] : [s.slice(0, k), s.slice(k)];
}
export function decodeValue(s) { return takeValue(s)[0]; }
function oneLine(s) { return String(s == null ? '' : s).replace(/\s*[\r\n]+\s*/g, ' ').trim(); }
function short(s, n = 24) { s = oneLine(s); return s.length > n ? s.slice(0, n - 1) + '…' : s; }

/** Summary for a set of cell changes: "Tune EnemyDef: Slime hp 45 → 52" or "Tune EnemyDef, SpellDef: 4 changes". */
export function tuneSummary(changes, nameOf) {
  const tables = [...new Set(changes.map((c) => c.table))];
  if (changes.length === 1) {
    const c = changes[0];
    const name = nameOf ? nameOf(c) : c.key;
    return `Tune ${c.table}: ${short(name, 40)} ${c.column} ${short(c.from)}${ARROW}${short(c.to)}`;
  }
  const head = tables.length <= 3 ? tables.join(', ') : `${tables.slice(0, 3).join(', ')} +${tables.length - 3}`;
  return `Tune ${head}: ${changes.length} changes`;
}

/**
 * Build a commit message.
 * @param {{summary:string, cells?:Array<{table,key,column,from,to}>, assets?:Array<{group,id,from,to}>, pages?:Array<{id,what?}>, lines?:string[], note?:string, source?:string}} m
 */
export function buildCommitMessage(m) {
  const body = [];
  for (const c of m.cells || []) body.push(`${c.table}|${c.key}|${c.column}: ${encodeValue(c.from)}${ARROW}${encodeValue(c.to)}`);
  for (const a of m.assets || []) body.push(`asset|${a.group}|${a.id}: ${encodeValue(a.from)}${ARROW}${encodeValue(a.to)}`);
  for (const p of m.pages || []) body.push(`page|${p.id}: ${p.what || 'edited'}`);
  for (const l of m.lines || []) body.push(oneLine(l));
  const note = oneLine(m.note);
  if (note) body.push(`Note: ${note}`);
  let msg = `hub: ${oneLine(m.summary)}\n\n`;
  if (body.length) msg += body.join('\n') + '\n\n';
  msg += `Hub-Source: ${m.source || 'app'}\n`;
  return msg;
}

const CELL_RE = /^([^|\s][^|]*)\|([^|]+)\|([^:|]+): (.*)$/;

function splitArrow(rest) {
  const [from, r1] = takeValue(rest);
  if (!r1.startsWith(ARROW)) return null;
  const [to, tail] = takeValue(r1.slice(ARROW.length));
  if (tail.trim()) return null;
  return [from, to];
}

/** Parse any commit message → {hub, summary, cells, assets, pages, note, source, issues}. Non-hub messages: hub=false. */
export function parseCommitMessage(message) {
  const text = String(message || '').replace(/\r\n/g, '\n');
  const lines = text.split('\n');
  const first = lines[0] || '';
  const out = { hub: first.startsWith('hub:'), summary: first.replace(/^hub:\s*/, ''), cells: [], assets: [], pages: [], note: '', source: null, issues: [] };
  for (const raw of lines.slice(1)) {
    const l = raw.trimEnd();
    let m;
    if ((m = /^Hub-Source:\s*(\S+)/.exec(l))) { out.source = m[1]; continue; }
    if ((m = /^Note: (.*)$/.exec(l))) { out.note = out.note ? out.note + '\n' + m[1] : m[1]; for (const x of m[1].matchAll(/#(\d+)/g)) out.issues.push(Number(x[1])); continue; }
    if ((m = /^page\|([^:]+):\s*(.*)$/.exec(l))) { out.pages.push({ id: m[1], what: m[2] }); continue; }
    if ((m = /^asset\|([^|]+)\|(.+?): (.*)$/.exec(l))) {
      const p = splitArrow(m[3]);
      if (p) out.assets.push({ group: m[1], id: m[2], from: p[0], to: p[1] });
      continue;
    }
    if ((m = CELL_RE.exec(l))) {
      const p = splitArrow(m[4]);
      if (p) out.cells.push({ table: m[1], key: m[2], column: m[3], from: p[0], to: p[1] });
    }
  }
  return out;
}
