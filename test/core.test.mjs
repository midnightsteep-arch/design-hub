// Core logic tests: canonical vectors, §5 serialiser (golden), commit messages, §8 re-apply, page merge.
// Run from design-hub/app:  node --test site/test/
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { canon, canonFloat, canonFloat64, parseInput, validateCanon } from '../app/canon.js';
import { serializeTable, parseTable, reapplyChanges, compareOrdinal, cellCanon } from '../app/tablefile.js';
import { buildCommitMessage, parseCommitMessage, tuneSummary, encodeValue } from '../app/commitmsg.js';
import { merge3, joinChunks } from '../app/merge3.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const vectors = JSON.parse(readFileSync(path.join(here, '../../../references/canonical-vectors.json'), 'utf8'));

test('canonical vectors: float32', () => {
  for (const [input, want] of vectors.float32) assert.equal(canon({ type: 'float', precision: 32 }, input), want, `float32 ${input}`);
  // precision absent = 32 (Tuning Desk compatibility)
  for (const [input, want] of vectors.float32) assert.equal(canon({ type: 'float' }, input), want);
  assert.equal(canonFloat(-0), '0');
  assert.equal(canonFloat(3.4028235e+38), '3.4028235e+38'); // FLT_MAX
  assert.equal(canon({ type: 'float' }, '3.4028235e38'), '3.4028235e+38');
  assert.equal(canon({ type: 'float' }, '3.5e38'), null); // overflows float32
});
test('canonical vectors: float64', () => {
  for (const [input, want] of vectors.float64) assert.equal(canon({ type: 'float', precision: 64 }, input), want, `float64 ${input}`);
  assert.equal(canonFloat64(-0), '0');
  assert.equal(canon({ type: 'float', precision: 64 }, '-0'), '0');
  assert.equal(canon({ type: 'float', precision: 64 }, '1e-7'), '1e-7');
});
test('canonical vectors: int, bool, color, string', () => {
  for (const [i, w] of vectors.int) assert.equal(canon({ type: 'int' }, i), w);
  for (const [i, w] of vectors.bool) assert.equal(canon({ type: 'bool' }, i), w);
  for (const [i, w] of vectors.color) assert.equal(canon({ type: 'color' }, i), w);
  for (const [i, w] of vectors.string) assert.equal(canon({ type: 'string' }, i), w);
});
test('canonical vectors: lists, vectors, flags', () => {
  for (const [i, w] of vectors.list_float32) assert.equal(canon({ type: 'list', itemType: 'float' }, i), w);
  for (const [i, w] of vectors.list_string) assert.equal(canon({ type: 'list', itemType: 'string' }, i), w);
  for (const [i, w] of vectors.vector2_float32) assert.equal(canon({ type: 'vector2', itemType: 'float' }, i), w);
  for (const v of vectors.flags) assert.equal(canon({ type: 'flags', options: v.options }, v.input), v.canonical);
  // precision 64 lists keep the double
  assert.equal(canon({ type: 'list', itemType: 'float', precision: 64 }, [0.1, 0.3333333333333333]), '[0.1, 0.3333333333333333]');
  assert.equal(canon({ type: 'vector2', itemType: 'int' }, '[3, 4]'), '[3, 4]');
});
test('designer input parsing follows precision', () => {
  assert.deepEqual(parseInput({ type: 'float', precision: 64 }, '0.3333333333333333'), { ok: true, value: '0.3333333333333333' });
  assert.deepEqual(parseInput({ type: 'float', precision: 32 }, '0.3333333333333333'), { ok: true, value: '0.33333334' });
  assert.deepEqual(parseInput({ type: 'int', min: 1 }, '250*2'), { ok: true, value: '500' });
  assert.equal(parseInput({ type: 'int', min: 1 }, '0').ok, false);
  assert.equal(validateCanon({ type: 'int', readOnly: true }, '5').ok, false);
  assert.equal(validateCanon({ type: 'int', max: 10 }, '11').ok, false);
});

// ------------------------------------------------------------- §5 serialiser
const schemaTable = { id: 'EnemyDef', columns: [{ id: 'hp', type: 'int' }, { id: 'speed', type: 'float', precision: 64 }, { id: 'tags', type: 'list', itemType: 'string' }, { id: 'lore', type: 'string' }] };
test('§5 serialiser is byte-exact (golden file)', () => {
  const rows = [
    { key: 'zz9', name: 'Zed "Z"', values: { lore: 'line1\nline2 é', hp: '10' } },
    { key: 'b8x1k2', name: 'Slime', values: { tags: '["Fire"]', speed: '2.5', hp: '45' } },
    { key: 'Ab', name: 'Upper', values: {} },
    { key: 'b8x1k2/#0', name: 'Slime › #0', values: { hp: '1', extra: 'kept' } },
  ];
  const got = serializeTable('EnemyDef', rows, schemaTable);
  const golden = readFileSync(path.join(here, 'golden/EnemyDef.json'), 'utf8');
  assert.equal(got, golden);
  // round trip: parse → serialise gives the same bytes
  const p = parseTable(got);
  assert.equal(serializeTable(p.table, p.rows, schemaTable), golden);
});
test('§5 empty rows', () => {
  assert.equal(serializeTable('Empty', [], schemaTable), '{\n  "table": "Empty",\n  "rows": []\n}\n');
});
test('ordinal key order is byte order, not locale order', () => {
  const keys = ['b', 'B', 'a/1', 'a', '#1', 'é', 'z', '\u{1F600}', '�'];
  const sorted = [...keys].sort(compareOrdinal);
  const bytes = [...keys].sort((x, y) => Buffer.compare(Buffer.from(x, 'utf8'), Buffer.from(y, 'utf8')));
  assert.deepEqual(sorted, bytes);
});
test('fixture table files are byte-exact §5', () => {
  const dir = path.join(here, '../dev/fixture/repo/design/tuning');
  let schema;
  try { schema = JSON.parse(readFileSync(path.join(dir, 'schema.json'), 'utf8')); } catch (e) { return; }
  for (const t of schema.tables) {
    const text = readFileSync(path.join(dir, 'tables', t.id + '.json'), 'utf8');
    const p = parseTable(text);
    assert.equal(serializeTable(p.table, p.rows, t), text, t.id);
  }
});

// ------------------------------------------------------------- commit messages
test('commit message format (§8)', () => {
  const msg = buildCommitMessage({
    summary: tuneSummary([{ table: 'EnemyDef', key: 'b8x1k2', column: 'hp', from: '45', to: '52' }], () => 'Slime'),
    cells: [{ table: 'EnemyDef', key: 'b8x1k2', column: 'hp', from: '45', to: '52' }],
    note: 'Slime felt too squishy',
  });
  assert.equal(msg, 'hub: Tune EnemyDef: Slime hp 45 → 52\n\nEnemyDef|b8x1k2|hp: 45 → 52\nNote: Slime felt too squishy\n\nHub-Source: app\n');
  const p = parseCommitMessage(msg);
  assert.equal(p.hub, true);
  assert.equal(p.source, 'app');
  assert.equal(p.note, 'Slime felt too squishy');
  assert.deepEqual(p.cells, [{ table: 'EnemyDef', key: 'b8x1k2', column: 'hp', from: '45', to: '52' }]);
});
test('commit message: multi-change summary, no note, awkward values round-trip', () => {
  const cells = [
    { table: 'EnemyDef', key: 'a', column: 'lore', from: '', to: 'two\nlines → arrow' },
    { table: 'EnemyDef.drops', key: 'a/gel', column: 'chance', from: '0.5', to: '0.25' },
    { table: 'SpellDef', key: 'f1', column: 'tags', from: '["a"]', to: '"quoted"' },
  ];
  const msg = buildCommitMessage({ summary: tuneSummary(cells), cells, note: 'Applies #12\nsecond line', source: 'app' });
  assert.ok(msg.startsWith('hub: Tune EnemyDef, EnemyDef.drops, SpellDef: 3 changes\n\n'));
  assert.ok(msg.endsWith('\nNote: Applies #12 second line\n\nHub-Source: app\n'));
  const p = parseCommitMessage(msg);
  assert.deepEqual(p.cells, cells);
  assert.deepEqual(p.issues, [12]);
  assert.equal(encodeValue('plain'), 'plain');
  // gitlog.py rules: ∅ for absent; quote empty, padded, newline, any →, leading " or ∅
  assert.equal(encodeValue(null), '∅');
  assert.equal(encodeValue(''), '""');
  assert.equal(encodeValue(' x'), '" x"');
  assert.equal(encodeValue('a→b'), '"a→b"');
  assert.equal(encodeValue('∅x'), '"∅x"');
  assert.equal(encodeValue('[1, 2]'), '[1, 2]');
  const absent = parseCommitMessage('hub: x\n\nT|k|c: ∅ → 5\nT|k|d: "" → ∅\n\nHub-Source: claude\n');
  assert.deepEqual(absent.cells, [{ table: 'T', key: 'k', column: 'c', from: null, to: '5' }, { table: 'T', key: 'k', column: 'd', from: '', to: null }]);
  const b = buildCommitMessage({ summary: 's', cells: [{ table: 'T', key: 'k', column: 'c', from: null, to: 'x' }] });
  assert.ok(b.includes('T|k|c: ∅ → x'));
});
test('commit message: assets and pages lines; non-hub messages', () => {
  const msg = buildCommitMessage({ summary: 'Review Slime: approved', assets: [{ group: 'forest', id: 'texture:abc', from: 'pending_review', to: 'approved' }], pages: [{ id: 'pitch' }] });
  const p = parseCommitMessage(msg);
  assert.deepEqual(p.assets, [{ group: 'forest', id: 'texture:abc', from: 'pending_review', to: 'approved' }]);
  assert.deepEqual(p.pages, [{ id: 'pitch', what: 'edited' }]);
  const q = parseCommitMessage('Fix crash on load\n\nSome body: with colon');
  assert.equal(q.hub, false);
  assert.equal(q.cells.length, 0);
  const g = parseCommitMessage('hub: Sync from Godot\n\nEnemyDef|k1|hp: 1 → 2\n\nHub-Source: godot');
  assert.equal(g.source, 'godot');
  assert.equal(g.cells.length, 1);
});

// ------------------------------------------------------------- §8 concurrency re-apply
test('re-apply: unchanged cell applies, changed cell conflicts, same-value is a no-op', () => {
  const theirs = { table: 'EnemyDef', rows: [
    { key: 'k1', name: 'Slime', values: { hp: '45', speed: '2.5' } },
    { key: 'k2', name: 'Bat', values: { hp: '20', speed: '6' } },
  ] };
  const changes = [
    { table: 'EnemyDef', key: 'k1', column: 'hp', from: '45', to: '52' },      // still 45 → applies
    { table: 'EnemyDef', key: 'k2', column: 'speed', from: '6.5', to: '5.8' }, // someone changed 6.5 → 6 → conflict
    { table: 'EnemyDef', key: 'k2', column: 'hp', from: '18', to: '20' },      // already 20 → no-op
    { table: 'EnemyDef', key: 'k1', column: 'lore', from: '', to: 'Squishy' }, // absent cell = "" default → applies
  ];
  const r = reapplyChanges(theirs, schemaTable, changes);
  assert.equal(r.applied.length, 3);
  assert.deepEqual(r.conflicts, [{ ...changes[1], current: '6' }]);
  assert.equal(r.data.rows[0].values.hp, '52');
  assert.equal(r.data.rows[0].values.lore, 'Squishy');
  assert.equal(r.data.rows[1].values.speed, '6', 'conflicting cell is not overwritten');
  assert.equal(theirs.rows[0].values.hp, '45', 'input not mutated');
  // canonical comparison: "2.50" in the file equals from "2.5"
  const r2 = reapplyChanges({ table: 'EnemyDef', rows: [{ key: 'k1', name: 'S', values: { speed: '2.50' } }] }, schemaTable, [{ table: 'EnemyDef', key: 'k1', column: 'speed', from: '2.5', to: '3' }]);
  assert.equal(r2.conflicts.length, 0);
  assert.equal(cellCanon(r2.data, schemaTable.columns[1], 'k1'), '3');
});

// ------------------------------------------------------------- page merge
test('three-way page merge: disjoint edits merge, overlap conflicts', () => {
  const base = 'a\nb\nc\nd\ne\n';
  const mine = 'a\nB-mine\nc\nd\ne\n';
  const theirs = 'a\nb\nc\nd\nE-theirs\nf\n';
  const m = merge3(base, mine, theirs);
  assert.equal(m.clean, true);
  assert.equal(m.text, 'a\nB-mine\nc\nd\nE-theirs\nf\n');
  const x = merge3(base, 'a\nX\nc\nd\ne\n', 'a\nY\nc\nd\ne\n');
  assert.equal(x.clean, false);
  assert.deepEqual(x.conflicts[0].mine, ['X']);
  assert.deepEqual(x.conflicts[0].theirs, ['Y']);
  assert.equal(joinChunks(x.chunks, (c) => c.theirs), 'a\nY\nc\nd\ne\n');
  assert.equal(merge3(base, base, base).text, base);
  assert.equal(merge3(base, mine, base).text, mine);
  assert.equal(merge3('', 'new\n', '').text, 'new\n');
});
