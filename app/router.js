// Hash router (contract §12): #/<owner>/<repo>/<section>/<id>?query
// sections: page, tuning, assets, discussions, history. "#/" is the landing page.
import { createStore, useStore } from './store.js';

const e = encodeURIComponent;
function dec(s) { try { return decodeURIComponent(s); } catch (x) { return s; } }
export const SECTIONS = ['page', 'tuning', 'assets', 'discussions', 'history'];

export function toQuery(q) {
  if (!q) return '';
  const parts = [];
  for (const [k, v] of Object.entries(q)) {
    if (v == null || v === '' || (Array.isArray(v) && !v.length)) continue;
    parts.push(`${e(k)}=${e(Array.isArray(v) ? v.join(',') : v)}`);
  }
  return parts.length ? '?' + parts.join('&') : '';
}

export function parseHash(hash) {
  let s = (hash || '').replace(/^#/, '');
  if (!s.startsWith('/')) s = '/' + s;
  const qi = s.indexOf('?');
  const pathPart = qi >= 0 ? s.slice(0, qi) : s;
  const queryPart = qi >= 0 ? s.slice(qi + 1) : '';
  const segs = pathPart.split('/').filter(Boolean).map(dec);
  const query = {};
  for (const [k, v] of new URLSearchParams(queryPart)) query[k] = v;
  const r = { name: 'notfound', owner: null, repo: null, section: null, id: null, query, hash: '#' + s };
  if (!segs.length) { r.name = 'landing'; return r; }
  if (segs.length >= 2) {
    r.owner = segs[0]; r.repo = segs[1];
    if (segs.length === 2) { r.name = 'repo'; return r; }
    if (SECTIONS.includes(segs[2])) {
      r.name = r.section = segs[2];
      r.id = segs.length > 3 ? segs.slice(3).join('/') : null;
    }
  }
  return r;
}

export const router = createStore({ route: parseHash(location.hash) });
export function useRoute() { return useStore(router, (s) => s.route); }

/** Links inside the current repo (owner/repo from the current route unless given). */
function base(o, r) {
  const cur = router.get().route;
  return `#/${e(o || cur.owner)}/${e(r || cur.repo)}`;
}
export const href = {
  landing: () => '#/',
  repo: (o, r) => base(o, r),
  page: (id, q) => `${base()}/page/${e(id)}${toQuery(q)}`,
  tuning: (tableId, q) => `${base()}/tuning${tableId ? '/' + e(tableId) : ''}${toQuery(q)}`,
  assets: (groupId, q) => `${base()}/assets${groupId ? '/' + e(groupId) : ''}${toQuery(q)}`,
  asset: (assetId, groupId) => `${base()}/assets${groupId ? '/' + e(groupId) : ''}${toQuery({ asset: assetId })}`,
  discussions: (n, q) => `${base()}/discussions${n ? '/' + e(n) : ''}${toQuery(q)}`,
  history: (q) => `${base()}/history${toQuery(q)}`,
};

let pendingKeepScroll = false;
export function navigate(to, { replace = false, keepScroll = false } = {}) {
  if (!to.startsWith('#')) to = '#' + to;
  if (to === location.hash) return;
  pendingKeepScroll = keepScroll;
  if (replace) location.replace(to);
  else location.hash = to;
}
/** Change only the query of the current route. */
export function setQuery(patch, opts = { replace: true, keepScroll: true }) {
  const r = router.get().route;
  const q = { ...r.query, ...patch };
  const path = r.hash.split('?')[0];
  navigate(path + toQuery(q), opts);
}

// ------------------------------------------------------------- scroll restoration
const scrollMap = new Map();
let currentKey = null;
let keySeq = Date.now();
function stamp() {
  const st = history.state;
  if (st && st.hubKey) { currentKey = st.hubKey; return true; }
  currentKey = 'k' + (keySeq++);
  try { history.replaceState({ ...(st || {}), hubKey: currentKey }, ''); } catch (x) { /* ignore */ }
  return false;
}
try { history.scrollRestoration = 'manual'; } catch (x) { /* ignore */ }
let raf = 0;
window.addEventListener('scroll', () => {
  if (raf) return;
  raf = requestAnimationFrame(() => { raf = 0; if (currentKey) scrollMap.set(currentKey, window.scrollY); });
}, { passive: true });
stamp();

export function routeChanged() {
  const prev = router.get().route;
  const route = parseHash(location.hash);
  const keep = pendingKeepScroll;
  pendingKeepScroll = false;
  router.set({ route });
  const known = stamp();
  if (keep) return;
  const samePath = prev.hash.split('?')[0] === route.hash.split('?')[0];
  if (samePath) return; // query-only changes (filters, drawers) keep the scroll position
  if (known && scrollMap.has(currentKey)) {
    const y = scrollMap.get(currentKey);
    const t0 = performance.now();
    const tryIt = () => {
      const maxY = document.documentElement.scrollHeight - window.innerHeight;
      if (maxY >= y - 2 || performance.now() - t0 > 1500) { window.scrollTo(0, Math.min(y, Math.max(0, maxY))); return; }
      setTimeout(tryIt, 60);
    };
    requestAnimationFrame(tryIt);
  } else window.scrollTo(0, 0);
}
window.addEventListener('hashchange', routeChanged);
