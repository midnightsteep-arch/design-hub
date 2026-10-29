// GitHub layer (contract §8, §9, §11): token auth, REST reads, atomic Git Data API commits, issues.
// The only module that talks to the network. Every failure becomes a GhError with a plain-language message.
import config from '../config.js';

// ------------------------------------------------------------- endpoints / mock mode
const isLocalHost = (h) => h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h === '::1';
function resolveEndpoints() {
  let api = 'https://api.github.com';
  let worker = String(config.workerUrl || '').replace(/\/+$/, '');
  let mock = false;
  try {
    const q = new URLSearchParams(location.search).get('api');
    if (q && isLocalHost(location.hostname)) {
      const u = new URL(q);
      if ((u.protocol === 'http:' || u.protocol === 'https:') && isLocalHost(u.hostname)) {
        api = u.origin; worker = u.origin; mock = true;
      }
    }
  } catch (e) { /* ignore bad ?api= */ }
  return { api, worker, mock };
}
export const endpoints = resolveEndpoints();

export class GhError extends Error {
  constructor(status, message, data, code) {
    super(message);
    this.status = status;
    this.data = data || {};
    this.code = code || null;
  }
}
export class StaleRefError extends GhError {
  constructor(data) { super(422, 'Someone else saved changes at the same moment.', data, 'stale_ref'); }
}

// ------------------------------------------------------------- auth (§11)
const AUTH_KEY = 'hub.auth';
let auth = null;
const authSubs = new Set();
export function onAuthChange(fn) { authSubs.add(fn); return () => authSubs.delete(fn); }
function emitAuth() { authSubs.forEach((f) => { try { f(auth); } catch (e) { /* ignore */ } }); }

function loadAuth() {
  try {
    const a = JSON.parse(localStorage.getItem(AUTH_KEY) || 'null');
    if (a && a.token && a.api === endpoints.api) return a;
  } catch (e) { /* ignore */ }
  return null;
}
function saveAuth(a) {
  auth = a;
  try { if (a) localStorage.setItem(AUTH_KEY, JSON.stringify(a)); else localStorage.removeItem(AUTH_KEY); } catch (e) { /* private mode */ }
  emitAuth();
}

/**
 * Consume the one-time callback fragment (#hub_token=…&hub_refresh=…&hub_exp=…&hub_return=…, or #hub_error=…),
 * remove it from the URL with history.replaceState, and store the tokens. Returns {error} when the Worker reported one.
 */
export function consumeAuthFragment() {
  const h = location.hash || '';
  if (!/^#hub_(token|error)=/.test(h)) return {};
  const p = new URLSearchParams(h.slice(1));
  const ret = p.get('hub_return');
  const clean = location.pathname + location.search + (ret ? '#' + ret.replace(/^#/, '') : '');
  try { history.replaceState(history.state, '', clean); } catch (e) { location.hash = ret || ''; }
  if (p.get('hub_error')) return { error: p.get('hub_error') };
  const exp = Number(p.get('hub_exp'));
  saveAuth({ token: p.get('hub_token'), refresh: p.get('hub_refresh') || null, exp: exp > 0 ? exp * 1000 : null, api: endpoints.api, at: Date.now() });
  return { signedIn: true };
}

export function currentAuth() { return auth; }
export function isSignedIn() { return !!(auth && auth.token); }
export function signInUrl() {
  const ret = location.origin + location.pathname + location.search + (location.hash || '');
  return endpoints.worker + '/login?return=' + encodeURIComponent(ret);
}
export function signIn() { location.assign(signInUrl()); }
export function signOut(reason) {
  signOutReason = reason || 'signedout';
  saveAuth(null);
}
export let signOutReason = null;
export function clearSignOutReason() { signOutReason = null; }

let refreshing = null;
async function refreshToken() {
  if (!auth || !auth.refresh) return false;
  if (refreshing) return refreshing;
  refreshing = (async () => {
    try {
      const res = await fetch(endpoints.worker + '/refresh', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: auth.refresh }),
      });
      if (res.status === 401 || res.status === 400) { signOut('expired'); return false; }
      if (!res.ok) return false; // outage: keep the current token and try again later
      const j = await res.json();
      if (!j.access_token) return false;
      saveAuth({ token: j.access_token, refresh: j.refresh_token || auth.refresh, exp: j.expires_at ? j.expires_at * 1000 : null, api: endpoints.api, at: Date.now() });
      return true;
    } catch (e) { return false; } finally { refreshing = null; }
  })();
  return refreshing;
}
async function ensureFresh() {
  if (auth && auth.exp && auth.refresh && auth.exp - Date.now() < 5 * 60 * 1000) await refreshToken();
}
// refresh in the background before expiry
setInterval(() => { if (document.visibilityState === 'visible') ensureFresh(); }, 60 * 1000);

auth = loadAuth();

// ------------------------------------------------------------- request
function friendly(status, data, path) {
  const m = (data && data.message) || '';
  if (status === 0) return 'Could not reach GitHub. Check your internet connection and try again.';
  if (status === 401) return 'Your sign-in has expired. Please sign in again.';
  if (status === 403 && /rate limit/i.test(m)) return 'GitHub is limiting requests for a few minutes. Wait a moment and try again.';
  if (status === 403) return "You don't have permission to change this repo. Ask the owner for Write access.";
  if (status === 404 && /^\/repos\/[^/]+\/[^/]+(\/(contents|git)|$)/.test(path)) return "You don't have access to this repo — ask the owner to add you as a collaborator.";
  if (status === 404) return 'Not found.';
  if (status === 409) return 'The repo is empty or busy. Try again in a moment.';
  if (status === 422) return m ? `GitHub refused the change: ${m}` : 'GitHub refused the change.';
  if (status >= 500) return 'GitHub is having trouble right now. Try again in a minute.';
  return m || `Request failed (${status})`;
}

export async function gh(method, path, body, opts = {}) {
  await ensureFresh();
  const headers = { Accept: opts.accept || 'application/vnd.github+json' };
  if (auth && auth.token) headers.Authorization = 'Bearer ' + auth.token;
  if (!endpoints.mock) headers['X-GitHub-Api-Version'] = '2022-11-28';
  const init = { method, headers, cache: 'no-store' };
  if (body !== undefined) { headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }
  if (opts.signal) init.signal = opts.signal;
  let res;
  try { res = await fetch(endpoints.api + path, init); } catch (e) {
    if (e && e.name === 'AbortError') throw e;
    throw new GhError(0, friendly(0), null, 'network');
  }
  if (res.status === 401 && !opts.noRetry) {
    if (await refreshToken()) return gh(method, path, body, { ...opts, noRetry: true });
    signOut('expired');
    throw new GhError(401, friendly(401), null, 'unauthorized');
  }
  if (res.status === 204) return null;
  if (opts.raw && res.ok) return new Uint8Array(await res.arrayBuffer());
  let data = null;
  const text = await res.text();
  try { data = text ? JSON.parse(text) : null; } catch (e) { data = { message: text }; }
  if (!res.ok) {
    if (opts.allow404 && res.status === 404) return null;
    throw new GhError(res.status, friendly(res.status, data, path), data);
  }
  if (opts.withHeaders) return { data, headers: res.headers };
  return data;
}

const enc = encodeURIComponent;
const encPath = (p) => String(p).split('/').map(enc).join('/');
const R = (o, r) => `/repos/${enc(o)}/${enc(r)}`;

// ------------------------------------------------------------- base64 / text
export function b64ToBytes(b64) {
  const bin = atob(String(b64 || '').replace(/\s+/g, ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
export function bytesToB64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
const td = new TextDecoder('utf-8');
export const bytesToText = (b) => td.decode(b);

// ------------------------------------------------------------- user / repos
export const getUser = () => gh('GET', '/user');
let user = null;
export function currentUser() { return user; }
export async function loadUser() { user = await getUser(); return user; }
onAuthChange((a) => { if (!a) user = null; });
export const getRepo = (o, r) => gh('GET', R(o, r));

/** All repos the signed-in user can reach through the App's installations (§12). */
export async function listInstallationRepos() {
  const inst = await gh('GET', '/user/installations?per_page=100');
  const out = [];
  for (const i of (inst && inst.installations) || []) {
    for (let page = 1; page <= 10; page++) {
      const r = await gh('GET', `/user/installations/${i.id}/repositories?per_page=100&page=${page}`);
      const list = (r && r.repositories) || [];
      out.push(...list);
      if (list.length < 100) break;
    }
  }
  return out;
}

// ------------------------------------------------------------- reads (immutable blobs cached by sha)
const blobCache = new Map(); // sha -> Uint8Array
export async function getHeadSha(o, r, branch) {
  const ref = await gh('GET', `${R(o, r)}/git/ref/heads/${encPath(branch)}`);
  return ref.object.sha;
}
export const getGitCommit = (o, r, sha) => gh('GET', `${R(o, r)}/git/commits/${enc(sha)}`);
export async function getTree(o, r, treeSha) {
  const t = await gh('GET', `${R(o, r)}/git/trees/${enc(treeSha)}?recursive=1`);
  const files = new Map();
  for (const e of t.tree || []) if (e.type === 'blob') files.set(e.path, { sha: e.sha, size: e.size || 0 });
  return { sha: t.sha, files, truncated: !!t.truncated };
}
export async function getBlob(o, r, sha) {
  if (blobCache.has(sha)) return blobCache.get(sha);
  const b = await gh('GET', `${R(o, r)}/git/blobs/${enc(sha)}`);
  const bytes = b.encoding === 'base64' ? b64ToBytes(b.content) : new TextEncoder().encode(b.content || '');
  blobCache.set(sha, bytes);
  return bytes;
}
/** Read a file via the contents API (base64); files over 1 MB go through the blobs API (§8). */
export async function readFile(o, r, path, ref, knownSha) {
  if (knownSha && blobCache.has(knownSha)) return { sha: knownSha, bytes: blobCache.get(knownSha) };
  const c = await gh('GET', `${R(o, r)}/contents/${encPath(path)}?ref=${enc(ref)}`, undefined, { allow404: true });
  if (!c) return null;
  if (Array.isArray(c)) throw new GhError(400, `${path} is a folder, not a file`);
  let bytes;
  if (c.encoding === 'base64' && c.content) bytes = b64ToBytes(c.content);
  else if (c.size === 0) bytes = new Uint8Array(0);
  else return { sha: c.sha, bytes: await getBlob(o, r, c.sha) };
  blobCache.set(c.sha, bytes);
  return { sha: c.sha, bytes };
}

// ------------------------------------------------------------- atomic commit (§8)
/**
 * One atomic commit: blobs → tree on the given parent → commit → PATCH ref with force:false.
 * files: [{path, text} | {path, bytes} | {path, delete:true}]
 * Throws StaleRefError when the branch moved (422 on the ref update).
 */
export async function commitFiles(o, r, branch, { parentSha, files, message }) {
  const parent = await getGitCommit(o, r, parentSha);
  const tree = [];
  for (const f of files) {
    if (f.delete) { tree.push({ path: f.path, mode: '100644', type: 'blob', sha: null }); continue; }
    const blob = f.bytes
      ? await gh('POST', `${R(o, r)}/git/blobs`, { content: bytesToB64(f.bytes), encoding: 'base64' })
      : await gh('POST', `${R(o, r)}/git/blobs`, { content: f.text, encoding: 'utf-8' });
    blobCache.set(blob.sha, f.bytes || new TextEncoder().encode(f.text));
    tree.push({ path: f.path, mode: '100644', type: 'blob', sha: blob.sha });
  }
  const newTree = await gh('POST', `${R(o, r)}/git/trees`, { base_tree: parent.tree.sha, tree });
  const commit = await gh('POST', `${R(o, r)}/git/commits`, { message, tree: newTree.sha, parents: [parentSha] });
  try {
    await gh('PATCH', `${R(o, r)}/git/refs/heads/${encPath(branch)}`, { sha: commit.sha, force: false });
  } catch (e) {
    if (e.status === 422 || e.status === 409) throw new StaleRefError(e.data);
    throw e;
  }
  return { sha: commit.sha, treeSha: newTree.sha };
}

// ------------------------------------------------------------- history (§8)
export async function listCommits(o, r, { sha, path, perPage = 30, page = 1 } = {}) {
  const q = new URLSearchParams({ per_page: String(perPage), page: String(page) });
  if (sha) q.set('sha', sha);
  if (path) q.set('path', path);
  const { data, headers } = await gh('GET', `${R(o, r)}/commits?${q}`, undefined, { withHeaders: true });
  const link = headers.get('link') || '';
  return { commits: data || [], hasMore: /rel="next"/.test(link) };
}
export const getCommitDetail = (o, r, sha) => gh('GET', `${R(o, r)}/commits/${enc(sha)}`);

// ------------------------------------------------------------- issues (§9)
export async function listIssues(o, r, { state = 'all', maxPages = 5 } = {}) {
  const out = [];
  for (let page = 1; page <= maxPages; page++) {
    const { data, headers } = await gh('GET', `${R(o, r)}/issues?state=${state}&per_page=100&page=${page}&sort=updated&direction=desc`, undefined, { withHeaders: true });
    out.push(...(data || []).filter((i) => !i.pull_request));
    if (!/rel="next"/.test(headers.get('link') || '')) break;
  }
  return out;
}
export const getIssue = (o, r, n) => gh('GET', `${R(o, r)}/issues/${n}`);
export const createIssue = (o, r, body) => gh('POST', `${R(o, r)}/issues`, body);
export const updateIssue = (o, r, n, body) => gh('PATCH', `${R(o, r)}/issues/${n}`, body);
export const listComments = (o, r, n) => gh('GET', `${R(o, r)}/issues/${n}/comments?per_page=100`);
export const addComment = (o, r, n, body) => gh('POST', `${R(o, r)}/issues/${n}/comments`, { body });
export const addLabels = (o, r, n, labels) => gh('POST', `${R(o, r)}/issues/${n}/labels`, { labels });

const LABEL_STYLE = {
  hub: { color: '7c5cff', description: 'Design Hub thread' },
  'hub:proposal': { color: 'e8743b', description: 'Design Hub: proposed value change' },
  'hub:applied': { color: '2da44e', description: 'Design Hub: proposal applied' },
  'hub:rejected': { color: 'cf222e', description: 'Design Hub: proposal rejected' },
  'hub:resolved': { color: '8c959f', description: 'Design Hub: thread resolved' },
};
const knownLabels = new Map(); // repo -> Set
/** Create the labels if they're missing (§9 "labels are created on first use"). Users without push can't; returns false then. */
export async function ensureLabels(o, r, names) {
  const k = o + '/' + r;
  let have = knownLabels.get(k);
  if (!have) {
    const list = await gh('GET', `${R(o, r)}/labels?per_page=100`);
    have = new Set((list || []).map((l) => l.name.toLowerCase()));
    knownLabels.set(k, have);
  }
  for (const n of names) {
    if (have.has(n.toLowerCase())) continue;
    try {
      await gh('POST', `${R(o, r)}/labels`, { name: n, ...(LABEL_STYLE[n] || { color: 'ededed' }) });
      have.add(n.toLowerCase());
    } catch (e) {
      if (e.status === 422) { have.add(n.toLowerCase()); continue; } // already exists
      if (e.status === 403 || e.status === 404) return false;
      throw e;
    }
  }
  return true;
}
