// Tests for the Design Hub mock server + fixture.
// Run from design-hub/app:  node --test site/test/mock.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { startServer } from '../dev/mock-server.mjs';
import { serializeTable, parseTable, reapplyChanges } from '../app/tablefile.js';
import { canon } from '../app/canon.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(HERE, '../dev/fixture');
const REPO_DIR = path.join(FIXTURE, 'repo');
const SLIME = 'cecaux1sm7mo0';
const BAT = 'b2k7wq0d3nhpa';
const TABLE = 'design/tuning/tables/EnemyDef.json';

let srv, workDir;
const tok = {};

async function call(method, p, { user, body, headers = {}, raw = false } = {}) {
  const h = { ...headers };
  if (user) h.Authorization = `Bearer ${tok[user]}`;
  if (body !== undefined) h['Content-Type'] = 'application/json';
  const res = await fetch(srv.url + p, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
  const buf = Buffer.from(await res.arrayBuffer());
  let json = null;
  if (!raw) { try { json = JSON.parse(buf.toString('utf8')); } catch { /* not json */ } }
  return { status: res.status, headers: res.headers, json, buf };
}
const api = (user) => ({
  get: (p, o = {}) => call('GET', p, { user, ...o }),
  post: (p, body, o = {}) => call('POST', p, { user, body, ...o }),
  patch: (p, body, o = {}) => call('PATCH', p, { user, body, ...o }),
  del: (p, o = {}) => call('DELETE', p, { user, ...o }),
});
async function signIn(login, ret = 'http://localhost:9/index.html') {
  const r = await call('GET', `/login?return=${encodeURIComponent(ret)}&user=${login}`);
  assert.equal(r.status, 302);
  return r.headers.get('location');
}
const fragParams = (loc) => new URLSearchParams(loc.slice(loc.indexOf('#') + 1));
const R = '/repos/studio/emberfall';

async function readFile(user, p, ref = 'main') {
  const r = await api(user).get(`${R}/contents/${p.split('/').map(encodeURIComponent).join('/')}?ref=${ref}`);
  assert.equal(r.status, 200, `read ${p}: ${r.status}`);
  return Buffer.from(r.json.content.replace(/\n/g, ''), 'base64');
}
/** blob → tree → commit → PATCH ref. Returns {status, json, commit}. */
async function commitFiles(user, files, message, parentSha) {
  const a = api(user);
  const parent = parentSha || (await a.get(`${R}/git/ref/heads/main`)).json.object.sha;
  const baseTree = (await a.get(`${R}/git/commits/${parent}`)).json.tree.sha;
  const tree = [];
  for (const f of files) {
    const b = await a.post(`${R}/git/blobs`, { content: Buffer.from(f.bytes).toString('base64'), encoding: 'base64' });
    assert.equal(b.status, 201);
    tree.push({ path: f.path, mode: '100644', type: 'blob', sha: b.json.sha });
  }
  const t = await a.post(`${R}/git/trees`, { base_tree: baseTree, tree });
  assert.equal(t.status, 201);
  const c = await a.post(`${R}/git/commits`, { message, tree: t.json.sha, parents: [parent] });
  assert.equal(c.status, 201);
  const p = await a.patch(`${R}/git/refs/heads/main`, { sha: c.json.sha, force: false });
  return { status: p.status, json: p.json, commit: c.json.sha };
}
function setHp(text, key, hp) {
  const schema = JSON.parse(fs.readFileSync(path.join(REPO_DIR, 'design/tuning/schema.json'), 'utf8')).tables.find((t) => t.id === 'EnemyDef');
  const data = parseTable(text);
  data.rows.find((r) => r.key === key).values.hp = hp;
  return serializeTable(data.table, data.rows, schema);
}

before(async () => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hubmock-'));
  srv = await startServer({ port: 0, quiet: true, workDir });
  for (const u of ['alice', 'bob', 'rita', 'nobody']) tok[u] = fragParams(await signIn(u)).get('hub_token');
});
after(async () => {
  await srv.close();
  fs.rmSync(workDir, { recursive: true, force: true });
});

test('sign-in redirect fragment format', async () => {
  const before = Math.floor(Date.now() / 1000);
  const loc = await signIn('alice', 'http://localhost:8790/?api=http://localhost:8790#/studio/emberfall/page/pitch');
  assert.match(loc, /^http:\/\/localhost:8790\/\?api=http:\/\/localhost:8790#hub_token=[^&]+&hub_refresh=[^&]+&hub_exp=\d+&hub_return=/);
  const q = fragParams(loc);
  assert.equal(q.get('hub_return'), '/studio/emberfall/page/pitch');
  assert.ok(Math.abs(Number(q.get('hub_exp')) - (before + 8 * 3600)) < 5);
  assert.ok(loc.includes('hub_return=%2Fstudio%2Femberfall%2Fpage%2Fpitch'));
  const noFrag = await signIn('bob', 'http://127.0.0.1:8790/');
  assert.ok(!noFrag.includes('hub_return'));
  assert.match(noFrag, /^http:\/\/127\.0\.0\.1:8790\/#hub_token=/);
  const deny = await call('GET', `/login?return=${encodeURIComponent('http://localhost:8790/#/x')}&deny=1`);
  assert.equal(deny.status, 302);
  assert.equal(deny.headers.get('location'), 'http://localhost:8790/#hub_error=access_denied');
  const bad = await call('GET', `/login?return=${encodeURIComponent('https://evil.example/')}`);
  assert.equal(bad.status, 400);
  const page = await call('GET', `/login?return=${encodeURIComponent('http://localhost:8790/')}`, { raw: true });
  assert.equal(page.status, 200);
  assert.match(page.buf.toString(), /Mock GitHub sign-in/);
  assert.match(page.buf.toString(), /rita<\/b> — read-only reviewer/);
});

test('401 without or with a bad token', async () => {
  const r = await call('GET', '/user');
  assert.equal(r.status, 401);
  assert.equal(r.json.message, 'Bad credentials');
  assert.ok(r.json.documentation_url);
  const r2 = await call('GET', '/user', { headers: { Authorization: 'Bearer nope' } });
  assert.equal(r2.status, 401);
  const r3 = await call('GET', '/user', { headers: { Authorization: `token ${tok.alice}` } });
  assert.equal(r3.status, 200);
});

test('/user', async () => {
  const r = await api('bob').get('/user');
  assert.equal(r.status, 200);
  assert.equal(r.json.login, 'bob');
  assert.equal(r.json.type, 'User');
  assert.equal(r.json.avatar_url, null);
  assert.equal(typeof r.json.id, 'number');
  assert.ok(r.json.name);
});

test('installations and repos (nobody sees none)', async () => {
  const i = await api('alice').get('/user/installations');
  assert.equal(i.json.total_count, 1);
  assert.equal(i.json.installations[0].id, 1);
  assert.equal(i.json.installations[0].account.login, 'studio');
  const ra = await api('alice').get('/user/installations/1/repositories?per_page=100');
  assert.deepEqual(ra.json.repositories.map((r) => r.full_name).sort(), ['studio/emberfall', 'studio/website']);
  const rb = await api('bob').get('/user/installations/1/repositories');
  assert.deepEqual(rb.json.repositories.map((r) => r.full_name), ['studio/emberfall']);
  assert.equal(rb.json.repositories[0].permissions.push, true);
  const n = await api('nobody').get('/user/installations');
  assert.equal(n.json.installations.length, 0);
  const nr = await api('nobody').get('/user/installations/1/repositories');
  assert.equal(nr.json.total_count, 0);
  assert.equal((await api('nobody').get(R)).status, 404);
  assert.equal((await api('bob').get('/repos/studio/website')).status, 404);
});

test('repo permissions for rita are read-only', async () => {
  const r = await api('rita').get(R);
  assert.equal(r.status, 200);
  assert.equal(r.json.permissions.push, false);
  assert.equal(r.json.permissions.pull, true);
  assert.equal(r.json.default_branch, 'main');
  assert.equal(r.json.private, true);
  assert.equal((await api('alice').get(R)).json.permissions.admin, true);
});

test('contents of hub.json (base64, raw, directory, missing)', async () => {
  const r = await api('rita').get(`${R}/contents/design/hub.json?ref=main`);
  assert.equal(r.status, 200);
  assert.equal(r.json.type, 'file');
  assert.equal(r.json.encoding, 'base64');
  assert.ok(r.json.content.split('\n').every((l) => l.length <= 60));
  const bytes = Buffer.from(r.json.content.replace(/\n/g, ''), 'base64');
  assert.deepEqual(bytes, fs.readFileSync(path.join(REPO_DIR, 'design/hub.json')));
  const hub = JSON.parse(bytes.toString('utf8'));
  assert.equal(hub.project.id, 'emberfall');
  assert.equal(hub.project.engine, 'godot');
  const gitSha = crypto.createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
  assert.equal(r.json.sha, gitSha);
  const enc = await api('rita').get(`${R}/contents/design%2Fhub.json`);
  assert.equal(enc.json.sha, gitSha);
  const raw = await api('rita').get(`${R}/contents/design/hub.json`, { headers: { Accept: 'application/vnd.github.raw' }, raw: true });
  assert.deepEqual(raw.buf, bytes);
  const dir = await api('rita').get(`${R}/contents/design/pages`);
  assert.deepEqual(dir.json.map((e) => e.name).sort(), ['enemies.md', 'pitch.md', 'spells.md']);
  assert.ok(dir.json.every((e) => e.type === 'file'));
  assert.equal((await api('rita').get(`${R}/contents/design/nope.md`)).status, 404);
  assert.equal((await api('rita').get('/repos/studio/website/contents/design/hub.json')).status, 404);
  assert.equal((await api('alice').get('/repos/studio/website/contents/design/hub.json')).status, 404);
});

test('tree listing (recursive)', async () => {
  const r = await api('rita').get(`${R}/git/trees/main?recursive=1`);
  assert.equal(r.status, 200);
  assert.equal(r.json.truncated, false);
  const byPath = new Map(r.json.tree.map((e) => [e.path, e]));
  for (const p of ['design/hub.json', TABLE, 'design/tuning/tables/EnemyDef.drops.json', 'design/assets/captures/forest-combat.png', 'art/enemies/slime.png'])
    assert.equal(byPath.get(p)?.type, 'blob', p);
  assert.equal(byPath.get('design')?.type, 'tree');
  assert.equal(byPath.get('design')?.mode, '040000');
  assert.equal(byPath.get('design/tuning/tables').type, 'tree');
  assert.equal(typeof byPath.get('design/hub.json').size, 'number');
  const flat = await api('rita').get(`${R}/git/trees/main`);
  assert.ok(flat.json.tree.every((e) => !e.path.includes('/')));
  const blob = await api('rita').get(`${R}/git/blobs/${byPath.get('design/hub.json').sha}`);
  assert.deepEqual(Buffer.from(blob.json.content, 'base64'), fs.readFileSync(path.join(REPO_DIR, 'design/hub.json')));
});

test('full commit: blob → tree → commit → PATCH ref, working dir matches', async () => {
  await call('POST', '/__mock/reset');
  const text = (await readFile('bob', TABLE)).toString('utf8');
  const next = setHp(text, SLIME, '52');
  const r = await commitFiles('bob', [{ path: TABLE, bytes: Buffer.from(next) }], `hub: Tune EnemyDef: Slime hp 45 → 52\n\nEnemyDef|${SLIME}|hp: 45 → 52\n\nHub-Source: app\n`);
  assert.equal(r.status, 200);
  assert.equal(r.json.ref, 'refs/heads/main');
  assert.equal(r.json.object.sha, r.commit);
  const onDisk = fs.readFileSync(path.join(workDir, 'studio', 'emberfall', ...TABLE.split('/')));
  assert.deepEqual(onDisk, Buffer.from(next));
  assert.deepEqual(await readFile('rita', TABLE), Buffer.from(next));
  const c = await api('rita').get(`${R}/git/commits/${r.commit}`);
  assert.equal(c.json.author.email, 'bob@users.noreply.github.com');
  assert.equal(c.json.author.name, 'Bob Okafor');
  const rc = await api('rita').get(`${R}/commits/${r.commit}`);
  assert.deepEqual(rc.json.files.map((f) => [f.filename, f.status]), [[TABLE, 'modified']]);
  assert.equal(rc.json.author.login, 'bob');
  // deletion via sha:null + add a binary file
  const a = api('alice');
  const head = r.commit;
  const base = (await a.get(`${R}/git/commits/${head}`)).json.tree.sha;
  const png = fs.readFileSync(path.join(FIXTURE, 'samples', 'slime_v2.png'));
  const b = await a.post(`${R}/git/blobs`, { content: png.toString('base64'), encoding: 'base64' });
  const t = await a.post(`${R}/git/trees`, { base_tree: base, tree: [
    { path: 'design/assets/replacements/texture_bmx3f1okc7a2d/20261023T120000Z.png', mode: '100644', type: 'blob', sha: b.json.sha },
    { path: 'README.md', mode: '100644', type: 'blob', sha: null },
  ] });
  const c2 = await a.post(`${R}/git/commits`, { message: 'hub: Attach replacement for Slime\n\nHub-Source: app\n', tree: t.json.sha, parents: [head] });
  assert.equal((await a.patch(`${R}/git/refs/heads/main`, { sha: c2.json.sha })).status, 200);
  assert.deepEqual(fs.readFileSync(path.join(workDir, 'studio/emberfall/design/assets/replacements/texture_bmx3f1okc7a2d/20261023T120000Z.png')), png);
  assert.equal(fs.existsSync(path.join(workDir, 'studio/emberfall/README.md')), false);
});

test('422 on a stale parent (not a fast forward)', async () => {
  await call('POST', '/__mock/reset');
  const head0 = (await api('bob').get(`${R}/git/ref/heads/main`)).json.object.sha;
  const text = (await readFile('bob', TABLE)).toString('utf8');
  const first = await commitFiles('bob', [{ path: TABLE, bytes: Buffer.from(setHp(text, SLIME, '50')) }], 'hub: one\n');
  assert.equal(first.status, 200);
  const stale = await commitFiles('alice', [{ path: TABLE, bytes: Buffer.from(setHp(text, BAT, '20')) }], 'hub: two\n', head0);
  assert.equal(stale.status, 422);
  assert.equal(stale.json.message, 'Update is not a fast forward');
  const bogus = await api('bob').patch(`${R}/git/refs/heads/main`, { sha: 'f'.repeat(40) });
  assert.equal(bogus.status, 422);
  assert.equal(bogus.json.message, 'Object does not exist');
  // force works
  const forced = await api('alice').patch(`${R}/git/refs/heads/main`, { sha: stale.commit, force: true });
  assert.equal(forced.status, 200);
});

test('/__mock/race makes the next PATCH 422; re-read + re-apply succeeds', async () => {
  await call('POST', '/__mock/reset');
  const text = (await readFile('bob', TABLE)).toString('utf8');
  const theirs = setHp(text, BAT, '22');
  const arm = await call('POST', '/__mock/race', { body: { files: [{ path: TABLE, content: theirs }], message: 'hub: Tune EnemyDef: Cave Bat hp 18 → 22\n\nHub-Source: app', author: 'alice' } });
  assert.equal(arm.status, 200);
  assert.equal((await call('GET', '/__mock/race')).json.armed, true);
  assert.equal((await call('GET', '/__mock/state')).json.raceArmed, true);
  const mine = setHp(text, SLIME, '60');
  const r1 = await commitFiles('bob', [{ path: TABLE, bytes: Buffer.from(mine) }], 'hub: Tune EnemyDef: Slime hp 45 → 60\n');
  assert.equal(r1.status, 422);
  assert.equal((await call('GET', '/__mock/race')).json.armed, false);
  // the app's job: re-read and re-apply cell by cell
  const fresh = (await readFile('bob', TABLE)).toString('utf8');
  assert.equal(fresh, theirs);
  const schema = JSON.parse(fs.readFileSync(path.join(REPO_DIR, 'design/tuning/schema.json'), 'utf8')).tables.find((t) => t.id === 'EnemyDef');
  const re = reapplyChanges(parseTable(fresh), schema, [{ table: 'EnemyDef', key: SLIME, column: 'hp', from: '45', to: '60' }]);
  assert.equal(re.conflicts.length, 0);
  const merged = serializeTable('EnemyDef', re.data.rows, schema);
  const r2 = await commitFiles('bob', [{ path: TABLE, bytes: Buffer.from(merged) }], 'hub: Tune EnemyDef: Slime hp 45 → 60\n');
  assert.equal(r2.status, 200);
  const final = parseTable((await readFile('rita', TABLE)).toString('utf8'));
  assert.equal(final.rows.find((r) => r.key === SLIME).values.hp, '60');
  assert.equal(final.rows.find((r) => r.key === BAT).values.hp, '22');
});

test('read-only user writes → 403', async () => {
  const a = api('rita');
  const b = await a.post(`${R}/git/blobs`, { content: 'x', encoding: 'utf-8' });
  assert.equal(b.status, 403);
  assert.equal(b.json.message, 'Resource not accessible by integration');
  assert.equal((await a.post(`${R}/git/trees`, { tree: [] })).status, 403);
  assert.equal((await a.post(`${R}/git/commits`, { message: 'x', tree: 'a'.repeat(40), parents: [] })).status, 403);
  assert.equal((await a.patch(`${R}/git/refs/heads/main`, { sha: 'a'.repeat(40) })).status, 403);
  assert.equal((await a.post(`${R}/labels`, { name: 'hub:applied', color: '0e8a16' })).status, 403);
});

test('commits?path=design lists seed + new commits, newest first, with Link pagination', async () => {
  await call('POST', '/__mock/reset');
  const seed = await api('rita').get(`${R}/commits?sha=main&path=design&per_page=30&page=1`);
  assert.equal(seed.status, 200);
  const subjects = seed.json.map((c) => c.commit.message.split('\n')[0]);
  assert.deepEqual(subjects, [
    'hub: Review Cave Bat sprite: needs replacement',
    'hub: Edit page Pitch',
    'hub: Sync from Godot (1 table changed)',
    'hub: Tune EnemyDef: Slime hp 40 → 45',
    'hub: Set up Design Hub',
  ]);
  assert.ok(seed.json[0].commit.message.includes('Hub-Source: app'));
  assert.equal(seed.json[3].author.login, 'bob');
  assert.ok(seed.json[3].commit.message.includes(`EnemyDef|${SLIME}|hp: 40 → 45`));
  const all = await api('rita').get(`${R}/commits?sha=main`);
  assert.equal(all.json.length, 6);
  const tbl = await api('rita').get(`${R}/commits?sha=main&path=${TABLE}`);
  assert.deepEqual(tbl.json.map((c) => c.commit.message.split('\n')[0]), ['hub: Tune EnemyDef: Slime hp 40 → 45', 'hub: Set up Design Hub']);
  const text = (await readFile('bob', TABLE)).toString('utf8');
  const r = await commitFiles('bob', [{ path: TABLE, bytes: Buffer.from(setHp(text, SLIME, '48')) }], 'hub: Tune EnemyDef: Slime hp 45 → 48\n\nHub-Source: app\n');
  assert.equal(r.status, 200);
  const nonDesign = await call('POST', '/__mock/commit', { body: { files: [{ path: 'scripts/new.gd', content: 'extends Node\n' }], message: 'Add script', author: 'alice' } });
  assert.equal(nonDesign.status, 201);
  const p1 = await api('rita').get(`${R}/commits?sha=main&path=design&per_page=2&page=1`);
  assert.deepEqual(p1.json.map((c) => c.commit.message.split('\n')[0]), ['hub: Tune EnemyDef: Slime hp 45 → 48', 'hub: Review Cave Bat sprite: needs replacement']);
  assert.match(p1.headers.get('link'), /[?&]page=2[^>]*>; rel="next"/);
  const p3 = await api('rita').get(`${R}/commits?sha=main&path=design&per_page=2&page=3`);
  assert.equal(p3.json.length, 2);
  assert.ok(!/rel="next"/.test(p3.headers.get('link') || ''));
});

test('issues: labels must exist, read users lose labels, close with state_reason', async () => {
  await call('POST', '/__mock/reset');
  const bob = api('bob'), rita = api('rita');
  const seed = await rita.get(`${R}/issues?state=all&labels=hub`);
  assert.deepEqual(seed.json.map((i) => i.number), [3, 2, 1, 4]);
  const open = await rita.get(`${R}/issues?labels=hub,hub:proposal`);
  assert.deepEqual(open.json.map((i) => i.number), [1]);
  assert.ok(open.json[0].body.startsWith('```hub-target\n'));
  assert.equal((await rita.get(`${R}/labels/hub:applied`)).status, 404);
  const body = '```hub-target\n{"type":"cell","table":"EnemyDef","key":"' + SLIME + '","column":"hp","from":"45","to":"50"}\n```\n\nSlime is too squishy.';
  const bad = await bob.post(`${R}/issues`, { title: 'Slime hp 45 → 50', body, labels: ['hub', 'hub:applied'] });
  assert.equal(bad.status, 422);
  assert.equal(bad.json.message, 'Validation Failed');
  const lab = await bob.post(`${R}/labels`, { name: 'hub:applied', color: '0e8a16', description: 'Design Hub: applied' });
  assert.equal(lab.status, 201);
  assert.equal((await bob.post(`${R}/labels`, { name: 'hub:applied', color: '0e8a16' })).json.errors[0].code, 'already_exists');
  const ok = await bob.post(`${R}/issues`, { title: 'Slime hp 45 → 50', body, labels: ['hub', 'hub:proposal'] });
  assert.equal(ok.status, 201);
  assert.equal(ok.json.number, 5);
  assert.deepEqual(ok.json.labels.map((l) => l.name), ['hub', 'hub:proposal']);
  assert.equal(ok.json.html_url, 'https://github.com/studio/emberfall/issues/5');
  const ri = await rita.post(`${R}/issues`, { title: 'A thought', body: '```hub-target\n{"type":"general"}\n```\n\nHi', labels: ['hub'] });
  assert.equal(ri.status, 201);
  assert.deepEqual(ri.json.labels, []);
  const cm = await rita.post(`${R}/issues/5/comments`, { body: 'Agree' });
  assert.equal(cm.status, 201);
  assert.equal(cm.json.user.login, 'rita');
  assert.equal((await rita.get(`${R}/issues/5`)).json.comments, 1);
  assert.equal((await rita.get(`${R}/issues/5/comments`)).json[0].body, 'Agree');
  assert.equal((await rita.post(`${R}/issues/5/labels`, { labels: ['hub:applied'] })).status, 403);
  assert.equal((await rita.patch(`${R}/issues/5`, { state: 'closed' })).status, 403);
  assert.equal((await rita.patch(`${R}/issues/6`, { labels: ['hub'] })).status, 403);
  const own = await rita.patch(`${R}/issues/6`, { state: 'closed' });
  assert.equal(own.status, 200);
  assert.equal(own.json.state_reason, 'completed');
  assert.equal((await bob.post(`${R}/issues/5/labels`, { labels: ['hub:nope'] })).status, 422);
  const add = await bob.post(`${R}/issues/5/labels`, { labels: ['hub:applied'] });
  assert.deepEqual(add.json.map((l) => l.name), ['hub', 'hub:proposal', 'hub:applied']);
  const closed = await bob.patch(`${R}/issues/5`, { state: 'closed', state_reason: 'not_planned' });
  assert.equal(closed.status, 200);
  assert.equal(closed.json.state, 'closed');
  assert.equal(closed.json.state_reason, 'not_planned');
  assert.ok(closed.json.closed_at);
  const rm = await bob.del(`${R}/issues/5/labels/hub%3Aproposal`);
  assert.deepEqual(rm.json.map((l) => l.name), ['hub', 'hub:applied']);
  assert.equal((await bob.del(`${R}/issues/5/labels/hub%3Aproposal`)).status, 404);
  const reopened = await bob.patch(`${R}/issues/5`, { state: 'open' });
  assert.equal(reopened.json.state_reason, 'reopened');
  assert.equal(reopened.json.closed_at, null);
  const page = await rita.get(`${R}/issues?state=all&per_page=2`);
  assert.equal(page.json.length, 2);
  assert.match(page.headers.get('link'), /rel="next"/);
  assert.equal((await api('nobody').get(`${R}/issues`)).status, 404);
});

test('refresh tokens and /__mock/expire', async () => {
  const loc = await signIn('bob');
  const q = fragParams(loc);
  const t = q.get('hub_token');
  await call('POST', '/__mock/expire');
  assert.equal((await call('GET', '/user', { headers: { Authorization: `Bearer ${t}` } })).status, 401);
  const r = await fetch(srv.url + '/refresh', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:8790' }, body: JSON.stringify({ refresh_token: q.get('hub_refresh') }) });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('access-control-allow-origin'), 'http://localhost:8790');
  const j = await r.json();
  assert.ok(j.access_token && j.refresh_token && j.expires_at);
  const me = await call('GET', '/user', { headers: { Authorization: `Bearer ${j.access_token}` } });
  assert.equal(me.json.login, 'bob');
  const bad = await fetch(srv.url + '/refresh', { method: 'POST', body: JSON.stringify({ refresh_token: 'nope' }) });
  assert.equal(bad.status, 401);
  assert.equal((await bad.json()).error, 'bad_refresh_token');
  assert.equal((await fetch(srv.url + '/refresh', { method: 'POST', body: 'garbage' })).status, 400);
  const pre = await fetch(srv.url + '/refresh', { method: 'OPTIONS', headers: { Origin: 'http://127.0.0.1:5000' } });
  assert.equal(pre.status, 204);
  // re-issue tokens for later tests
  for (const u of ['alice', 'bob', 'rita', 'nobody']) tok[u] = fragParams(await signIn(u)).get('hub_token');
});

test('reset restores the fixture state', async () => {
  const s0 = (await call('POST', '/__mock/reset')).json.head;
  await call('POST', '/__mock/commit', { body: { files: [{ path: 'design/pages/pitch.md', content: '# changed\n' }], message: 'hub: Edit page Pitch\n\nHub-Source: app', author: 'bob' } });
  await api('bob').post(`${R}/issues`, { title: 'x' });
  const mid = (await call('GET', '/__mock/state')).json;
  assert.notEqual(mid.head, s0);
  assert.equal(mid.issues, 5);
  assert.equal(fs.readFileSync(path.join(workDir, 'studio/emberfall/design/pages/pitch.md'), 'utf8'), '# changed\n');
  await call('POST', '/__mock/reset');
  const st = (await call('GET', '/__mock/state')).json;
  assert.equal(st.head, s0);
  assert.equal(st.commits, 6);
  assert.equal(st.issues, 4);
  assert.equal(st.raceArmed, false);
  assert.deepEqual(fs.readFileSync(path.join(workDir, 'studio/emberfall/design/pages/pitch.md')), fs.readFileSync(path.join(REPO_DIR, 'design/pages/pitch.md')));
  assert.equal((await api('alice').get('/user')).status, 200); // tokens survive reset
  const log = (await call('GET', '/__mock/log')).json;
  assert.ok(log.length > 0 && log.length <= 50);
  assert.ok(!JSON.stringify(log).includes(tok.alice));
});

test('static files are served from site/ without escaping it', async () => {
  const f = await call('GET', '/favicon.svg', { raw: true });
  assert.equal(f.status, 200);
  assert.equal(f.headers.get('content-type'), 'image/svg+xml');
  assert.equal(f.headers.get('cache-control'), 'no-store');
  const js = await call('GET', '/app/canon.js', { raw: true });
  assert.match(js.headers.get('content-type'), /^text\/javascript/);
  const esc = await fetch(srv.url + '/%2e%2e/worker/package.json');
  assert.notEqual(esc.status, 200);
});

test('fixture table files are byte-exact §5 serialisations with canonical values', () => {
  const schema = JSON.parse(fs.readFileSync(path.join(REPO_DIR, 'design/tuning/schema.json'), 'utf8'));
  const dir = path.join(REPO_DIR, 'design/tuning/tables');
  const files = fs.readdirSync(dir).sort();
  assert.deepEqual(files, ['EnemyDef.drops.json', 'EnemyDef.json', 'SpellDef.json']);
  for (const f of files) {
    const text = fs.readFileSync(path.join(dir, f), 'utf8');
    const data = parseTable(text);
    const st = schema.tables.find((t) => t.id === data.table);
    assert.ok(st, `schema table for ${f}`);
    assert.equal(f, `${data.table}.json`);
    assert.equal(serializeTable(data.table, data.rows, st), text, `${f} is not byte-exact`);
    const cols = new Map(st.columns.map((c) => [c.id, c]));
    for (const r of data.rows) for (const [k, v] of Object.entries(r.values)) {
      assert.equal(typeof v, 'string', `${f} ${r.key}.${k}`);
      assert.ok(cols.has(k), `${f}: unknown column ${k}`);
      assert.equal(canon(cols.get(k), v), v, `${f} ${r.key}.${k} = ${JSON.stringify(v)} is not canonical`);
    }
  }
  // schema hash
  const copy = { ...schema, generatedAt: '', hash: '' };
  assert.equal(crypto.createHash('sha256').update(JSON.stringify(copy, null, 2) + '\n').digest('hex'), schema.hash);
  // asset hashes match the files
  const man = JSON.parse(fs.readFileSync(path.join(REPO_DIR, 'design/assets/manifest/emberfall.json'), 'utf8'));
  for (const a of man.assets) {
    const h = a.kind === 'text' ? crypto.createHash('sha256').update(a.text, 'utf8').digest('hex') : crypto.createHash('sha256').update(fs.readFileSync(path.join(REPO_DIR, a.path))).digest('hex');
    assert.equal(a.contentHash, h, a.id);
  }
});
