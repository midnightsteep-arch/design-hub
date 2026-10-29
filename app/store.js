// Tiny global store + hooks, and app-level state (signed-in user, repo list, theme, dpr, focus ticks).
import { Component, h } from '../vendor/preact.module.js';
import { useLayoutEffect, useReducer, useRef } from '../vendor/hooks.module.js';
import { storage, setNumberSuffixes } from './lib.js';

export function createStore(state) {
  const subs = new Set();
  return {
    get: () => state,
    set(patch) {
      const next = typeof patch === 'function' ? patch(state) : patch;
      state = { ...state, ...next };
      subs.forEach((f) => f(state));
    },
    subscribe(f) { subs.add(f); return () => subs.delete(f); },
  };
}

export function useStore(store, sel = (s) => s) {
  const [, force] = useReducer((x) => x + 1, 0);
  const selRef = useRef(sel);
  selRef.current = sel;
  const val = sel(store.get());
  const valRef = useRef(val);
  valRef.current = val;
  useLayoutEffect(() => {
    const check = (s) => { const nv = selRef.current(s); if (!Object.is(nv, valRef.current)) force(); };
    const un = store.subscribe(check);
    check(store.get());
    return un;
  }, [store]);
  return val;
}

function shallowEq(a, b) {
  if (a === b) return true;
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) if (!Object.is(a[k], b[k])) return false;
  return true;
}
export function memo(C, eq = shallowEq) {
  class Memo extends Component {
    shouldComponentUpdate(np) { return !eq(this.props, np); }
    render(p) { return h(C, p); }
  }
  Memo.displayName = 'Memo(' + (C.displayName || C.name || 'C') + ')';
  return Memo;
}

// ---------------------------------------------------------------- app state
export const app = createStore({
  user: null,          // GET /user
  userError: null,
  signedIn: false,
  authError: null,     // hub_error code from the Worker, or 'expired'
  repos: null,         // landing list
  reposError: null,
  focusTick: 0,
  theme: 'system',
  dpr: typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1,
  navOpen: false,      // mobile nav drawer
});

// ---------------------------------------------------------------- theme
export function effectiveTheme() {
  const t = app.get().theme;
  if (t === 'light' || t === 'dark') return t;
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
export function setTheme(t) {
  if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
  else document.documentElement.removeAttribute('data-theme');
  try { localStorage.setItem('hub.theme', t === 'system' ? 'system' : t); } catch (e) { /* ignore */ }
  app.set({ theme: t });
}
(function initTheme() {
  let t = 'system';
  try { t = localStorage.getItem('hub.theme') || 'system'; } catch (e) { /* ignore */ }
  app.set({ theme: t });
})();

export function applyAccent(hex) {
  const ok = typeof hex === 'string' && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(hex.trim());
  document.documentElement.style.setProperty('--accent-base', ok ? hex.trim() : '#7c9cff');
}
export function applyProjectSettings(hub) {
  const p = (hub && hub.project) || {};
  applyAccent(p.accent);
  setNumberSuffixes(p.settings && p.settings.numberSuffixes);
}

// Focus/visibility ticks: views may refetch when the user comes back to the tab.
let started = false;
export function startFocusTracking() {
  if (started) return;
  started = true;
  let last = Date.now();
  const onFocus = () => {
    if (document.visibilityState !== 'visible' || Date.now() - last < 4000) return;
    last = Date.now();
    app.set((s) => ({ focusTick: s.focusTick + 1 }));
  };
  window.addEventListener('focus', onFocus);
  document.addEventListener('visibilitychange', onFocus);
  window.addEventListener('resize', () => { const d = window.devicePixelRatio || 1; if (d !== app.get().dpr) app.set({ dpr: d }); });
}
export function useFocusTick() { return useStore(app, (s) => s.focusTick); }
export function useDpr() { return useStore(app, (s) => s.dpr); }
export { storage };
