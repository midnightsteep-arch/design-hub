// App entry: auth fragment, sign-in gate, landing, repo shell (top bar + sidebar + section views).
import { html, render, cx } from './lib.js';
import { useEffect, useRef, useState } from '../vendor/hooks.module.js';
import { Icon } from './icons.js';
import { app, useStore, setTheme, applyProjectSettings, startFocusTracking, applyAccent } from './store.js';
import * as G from './github.js';
import { repoStore, openRepo, reloadRepo, startRepoPolling, blobUrl, dpath } from './repo.js';
import { loadThreads } from './discuss.js';
import { useRoute, href, navigate, routeChanged } from './router.js';
import { mountToasts, toast } from './components/toast.js';
import { Menu, Drawer } from './components/overlay.js';
import { Avatar, ErrorPanel, useMediaQuery } from './components/ui.js';
import { Sidebar } from './components/nav.js';
import { SignInView } from './views/signin.js';
import { LandingView } from './views/landing.js';
import { HomeView } from './views/home.js';
import { PageView } from './views/page.js';
import { TuningView } from './tuning/view.js';
import { StagingBar } from './tuning/stage.js';
import { AssetsView } from './views/assets.js';
import { DiscussionsView } from './views/discussions.js';
import { HistoryView } from './views/history.js';

// ---------------------------------------------------------------- auth bootstrap
const frag = G.consumeAuthFragment();
routeChanged();
if (frag.error) app.set({ authError: frag.error });
app.set({ signedIn: G.isSignedIn() });
G.onAuthChange((a) => {
  const was = app.get().signedIn;
  app.set({ signedIn: !!a, ...(a ? {} : { user: null, authError: was ? (G.signOutReason || 'signedout') : app.get().authError }) });
});

async function loadUser() {
  try { const u = await G.loadUser(); app.set({ user: u, userError: null }); } catch (e) { app.set({ userError: e }); }
}

// ---------------------------------------------------------------- top bar pieces
function ThemeToggle() {
  const theme = useStore(app, (s) => s.theme);
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const icon = theme === 'light' ? 'sun' : theme === 'dark' ? 'moon' : 'monitor';
  const label = theme === 'light' ? 'Light' : theme === 'dark' ? 'Dark' : 'System';
  return html`<button type="button" class="icon-btn" ref=${ref} aria-haspopup="menu" aria-expanded=${String(open)}
      aria-label=${`Theme: ${label}`} title=${`Theme: ${label}`} onClick=${() => setOpen(!open)}>
      <${Icon} name=${icon} size=${16} />
    </button>
    ${open && html`<${Menu} anchor=${ref} onClose=${() => setOpen(false)} placement="bottom-end" label="Theme" items=${[
      { label: 'System', icon: 'monitor', checked: theme === 'system', onSelect: () => setTheme('system') },
      { label: 'Light', icon: 'sun', checked: theme === 'light', onSelect: () => setTheme('light') },
      { label: 'Dark', icon: 'moon', checked: theme === 'dark', onSelect: () => setTheme('dark') },
    ]} />`}`;
}

function UserChip() {
  const user = useStore(app, (s) => s.user);
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  if (!user) return html`<span class="user-chip is-loading"><span class="skel" style="width:22px;height:22px;border-radius:50%"></span></span>`;
  const name = user.name || user.login;
  const items = [
    { heading: html`<div class="user-menu-head"><div class="user-menu-name">${name}</div><div class="user-menu-email">@${user.login}</div>
      <div class="user-menu-mode">Signed in with GitHub${G.endpoints.mock ? ' (local mock)' : ''}</div></div>` },
    { separator: true },
    { label: 'All projects', icon: 'grid', onSelect: () => navigate(href.landing()) },
    { label: 'Sign out', icon: 'logout', onSelect: () => { G.signOut('signedout'); navigate('#/', { replace: true }); } },
  ];
  return html`<button type="button" class="user-chip" ref=${ref} aria-haspopup="menu" aria-expanded=${String(open)} onClick=${() => setOpen(!open)}
      title=${'@' + user.login} aria-label=${`Signed in as ${name}`}>
      <${Avatar} actor=${user.login} size=${24} />
      <span class="user-name">${name}</span>
    </button>
    ${open && html`<${Menu} anchor=${ref} onClose=${() => setOpen(false)} placement="bottom-end" label="Account" items=${items} class="user-menu" />`}`;
}

function ProjectLogo({ hub, size = 24 }) {
  const files = useStore(repoStore, (s) => s.files);
  const [src, setSrc] = useState(null);
  const logo = hub && hub.project && hub.project.logo;
  useEffect(() => {
    let alive = true;
    setSrc(null);
    if (logo) blobUrl(dpath(logo)).then((u) => { if (alive) setSrc(u); }).catch(() => {});
    return () => { alive = false; };
  }, [logo, files]);
  const name = (hub && hub.project && hub.project.name) || '?';
  return html`<span class="proj-logo">${src ? html`<img src=${src} alt="" width=${size} height=${size} class="px-up" />` : html`<span class="proj-logo-fallback">${name.slice(0, 1)}</span>`}</span>`;
}

function NewChangesPill() {
  const n = useStore(repoStore, (s) => s.newCommits);
  const [busy, setBusy] = useState(false);
  if (!n) return null;
  const go = async () => { setBusy(true); try { await reloadRepo(); loadThreads({ force: true }); toast('Loaded the latest changes.'); } catch (e) { toast(e.message, { kind: 'error' }); } setBusy(false); };
  return html`<button type="button" class="newchanges-pill" onClick=${go} disabled=${busy} title="Someone saved changes. Reload to see them.">
    <${Icon} name="refresh" size=${14} /><span>Reload — ${n >= 50 ? '50+' : n} new change${n === 1 ? '' : 's'}</span></button>`;
}

function TopBar({ inRepo, onMenu }) {
  const hub = useStore(repoStore, (s) => s.hub);
  const canPush = useStore(repoStore, (s) => s.canPush);
  const status = useStore(repoStore, (s) => s.status);
  const key = useStore(repoStore, (s) => s.key);
  const project = hub && hub.project;
  return html`<header class="topbar">
    <div class="topbar-inner">
      ${inRepo && onMenu && html`<button type="button" class="icon-btn nav-toggle" onClick=${onMenu} aria-label="Open navigation"><${Icon} name="sidebar" size=${18} /></button>`}
      ${inRepo && key ? html`<a class="proj-switch" href=${href.repo()}><${ProjectLogo} hub=${hub} /><span class="proj-name">${project ? project.name : key}</span></a>`
        : html`<a class="proj-switch" href="#/"><span class="proj-logo"><img src="favicon.svg" alt="" width="24" height="24" /></span><span class="proj-name">Design Hub</span></a>`}
      ${inRepo && status === 'ready' && !canPush && html`<span class="badge badge-neutral readonly-badge" title="You can read and comment. Ask the owner for Write access to edit."><${Icon} name="eye" size=${12} /> Read-only</span>`}
      ${G.endpoints.mock && html`<span class="badge badge-accent mock-badge" title="Talking to the local mock server, not GitHub">Mock</span>`}
      <span class="spacer"></span>
      ${inRepo && html`<${NewChangesPill} />`}
      <${ThemeToggle} />
      <${UserChip} />
    </div>
  </header>`;
}

// ---------------------------------------------------------------- repo shell
function RepoBody({ route }) {
  const st = useStore(repoStore, (s) => s.status);
  const error = useStore(repoStore, (s) => s.error);
  const key = useStore(repoStore, (s) => s.key);
  if (key !== route.owner + '/' + route.repo || st === 'loading' || st === 'idle') {
    return html`<div class="container container-narrow"><div class="loading-block"><div class="boot-bar"></div><p class="muted">Loading ${route.owner}/${route.repo}…</p></div></div>`;
  }
  if (st === 'error') {
    const noAccess = error && (error.status === 404 || error.status === 403);
    return html`<div class="container container-narrow">
      ${noAccess ? html`<div class="empty"><div class="empty-icon"><${Icon} name="lock" size=${20} /></div>
          <div class="empty-title">You don't have access to this repo</div>
          <div class="empty-text">Ask the owner to add you as a collaborator on <b>${route.owner}/${route.repo}</b> (GitHub → Settings → Collaborators), then reload this page.</div>
          <p><a href="#/">See your projects</a></p></div>`
        : html`<${ErrorPanel} error=${error} title="Couldn't load this project" onRetry=${() => { repoStore.set({ key: null }); openRepo(route.owner, route.repo); }} />`}
    </div>`;
  }
  if (st === 'nohub') {
    return html`<div class="container container-narrow"><div class="empty"><div class="empty-icon"><${Icon} name="file" size=${20} /></div>
      <div class="empty-title">Design Hub isn't set up in this repo yet</div>
      <div class="empty-text">There is no <code>design/hub.json</code> on the default branch of <b>${route.owner}/${route.repo}</b>. Ask a developer to set it up with Claude (the design-hub skill).</div>
      <p><a href="#/">See your projects</a></p></div></div>`;
  }
  switch (route.name) {
    case 'repo': return html`<${HomeView} />`;
    case 'page': return html`<${PageView} key=${route.id} id=${route.id} query=${route.query} />`;
    case 'tuning': return html`<${TuningView} tableId=${route.id} query=${route.query} />`;
    case 'assets': return html`<${AssetsView} groupId=${route.id} query=${route.query} />`;
    case 'discussions': return html`<${DiscussionsView} number=${route.id ? Number(route.id) : null} query=${route.query} />`;
    case 'history': return html`<${HistoryView} query=${route.query} />`;
    default: return html`<${NotFound} />`;
  }
}

function RepoShell({ route }) {
  const hub = useStore(repoStore, (s) => s.hub);
  const st = useStore(repoStore, (s) => s.status);
  const wide = useMediaQuery('(min-width: 960px)');
  const [navOpen, setNavOpen] = useState(false);
  useEffect(() => { openRepo(route.owner, route.repo); }, [route.owner, route.repo]);
  useEffect(() => { if (st === 'ready') loadThreads(); }, [st, route.owner, route.repo]);
  useEffect(() => { applyProjectSettings(hub); }, [hub]);
  useEffect(() => {
    const p = hub && hub.project;
    document.title = p ? `${p.name} · Design Hub` : `${route.owner}/${route.repo} · Design Hub`;
  }, [hub, route.owner, route.repo]);
  useEffect(() => { setNavOpen(false); }, [route.hash]);
  const ready = st === 'ready';
  return html`<div class="shell hub-shell">
    <${TopBar} inRepo=${true} onMenu=${!wide && ready ? () => setNavOpen(true) : null} />
    <div class=${cx('hub-body', ready && wide && 'has-sidebar')}>
      ${ready && wide && html`<aside class="hub-sidebar" aria-label="Project navigation"><${Sidebar} route=${route} /></aside>`}
      <main id="main" tabindex="-1" class="main hub-main"><${RepoBody} route=${route} /></main>
    </div>
    ${ready && html`<${StagingBar} />`}
    ${navOpen && ready && html`<${Drawer} title=${(hub && hub.project && hub.project.name) || 'Navigation'} side="left" width=${300} onClose=${() => setNavOpen(false)}><${Sidebar} route=${route} /><//>`}
  </div>`;
}

function NotFound() {
  return html`<div class="container container-narrow"><div class="empty">
    <div class="empty-icon"><${Icon} name="map" size=${20} /></div>
    <div class="empty-title">This page doesn't exist</div>
    <div class="empty-text">The link may be out of date. <a href="#/">Go to your projects</a></div>
  </div></div>`;
}

// ---------------------------------------------------------------- App
function App() {
  const route = useRoute();
  const signedIn = useStore(app, (s) => s.signedIn);
  const user = useStore(app, (s) => s.user);
  const userError = useStore(app, (s) => s.userError);
  useEffect(() => { if (signedIn && !user) loadUser(); }, [signedIn]);
  useEffect(() => { if (route.name === 'landing' || !signedIn) applyAccent(null); }, [route.name, signedIn]);

  if (!signedIn) return html`<${SignInView} />`;
  if (!user && !userError) return html`<div class="boot-splash" aria-busy="true"><div class="boot-bar"></div></div>`;
  if (userError && !user) {
    return html`<div class="gate"><div class="gate-card">
      <${ErrorPanel} error=${userError} title="Can't reach GitHub" onRetry=${() => { app.set({ userError: null }); loadUser(); }} />
    </div></div>`;
  }
  if (route.name === 'landing') return html`<div class="shell"><${TopBar} inRepo=${false} /><main id="main" tabindex="-1" class="main"><${LandingView} /></main></div>`;
  if (route.owner && route.repo) return html`<${RepoShell} route=${route} />`;
  return html`<div class="shell"><${TopBar} inRepo=${false} /><main id="main" class="main"><${NotFound} /></main></div>`;
}

// ---------------------------------------------------------------- boot
mountToasts();
startFocusTracking();
startRepoPolling();
render(html`<${App} />`, document.getElementById('app'));
