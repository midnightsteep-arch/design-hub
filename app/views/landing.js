// Landing (§12): repos the user can reach through the GitHub App's installations that contain design/hub.json.
import { html } from '../lib.js';
import { useEffect, useState } from '../../vendor/hooks.module.js';
import { Icon } from '../icons.js';
import { app, useStore } from '../store.js';
import * as G from '../github.js';
import { href } from '../router.js';
import { EmptyState, ErrorPanel, Skeleton } from '../components/ui.js';

async function loadRepos() {
  app.set({ reposError: null });
  try {
    const repos = await G.listInstallationRepos();
    const withHub = await Promise.all(repos.map(async (r) => {
      try {
        const f = await G.readFile(r.owner.login, r.name, 'design/hub.json', r.default_branch || 'main');
        if (!f) return null;
        const hub = JSON.parse(G.bytesToText(f.bytes));
        return { ...r, hub };
      } catch (e) { return null; }
    }));
    app.set({ repos: withHub.filter(Boolean), reposAll: repos.length });
  } catch (e) {
    app.set({ reposError: e });
  }
}

function RepoCard({ r }) {
  const p = (r.hub && r.hub.project) || {};
  const accent = /^#[0-9a-f]{3,6}$/i.test(p.accent || '') ? p.accent : 'var(--accent)';
  return html`<a class="card repo-card" href=${href.repo(r.owner.login, r.name)} style=${`--repo-accent:${accent}`}>
    <div class="repo-card-head">
      <span class="repo-card-mark" aria-hidden="true">${(p.name || r.name).slice(0, 1)}</span>
      <div class="repo-card-main">
        <div class="repo-card-name">${p.name || r.name}</div>
        <div class="repo-card-repo muted">${r.full_name}</div>
      </div>
      ${r.permissions && !r.permissions.push && html`<span class="badge badge-neutral" title="You can read and comment">Read-only</span>`}
    </div>
    ${p.tagline && html`<p class="repo-card-tag">${p.tagline}</p>`}
    <div class="repo-card-foot muted">${p.engine ? html`<span class="badge badge-neutral">${p.engine === 'godot' ? 'Godot' : p.engine === 'unity' ? 'Unity' : p.engine}${p.engineVersion ? ' ' + p.engineVersion : ''}</span>` : null}
      <span class="spacer"></span><${Icon} name="arrow-right" size=${14} /></div>
  </a>`;
}

export function LandingView() {
  const repos = useStore(app, (s) => s.repos);
  const all = useStore(app, (s) => s.reposAll);
  const error = useStore(app, (s) => s.reposError);
  const user = useStore(app, (s) => s.user);
  useEffect(() => { document.title = 'Design Hub'; if (!repos) loadRepos(); }, []);
  // a single project: go straight in
  const [auto] = useState(() => !sessionStorage.getItem('hub.landingSeen'));
  useEffect(() => {
    if (repos && repos.length === 1 && auto) { try { sessionStorage.setItem('hub.landingSeen', '1'); } catch (e) { /* ignore */ } location.hash = href.repo(repos[0].owner.login, repos[0].name); }
  }, [repos]);
  return html`<div class="container container-narrow landing">
    <h1 class="page-title">Your projects</h1>
    <p class="page-sub">Hi${user ? ' ' + (user.name || user.login).split(' ')[0] : ''}! These are the games you can open in Design Hub.</p>
    <div style="height:20px"></div>
    ${error ? html`<${ErrorPanel} error=${error} title="Couldn't list your projects" onRetry=${loadRepos} />`
      : !repos ? html`<div class="repo-grid">${[0, 1].map((i) => html`<div class="card repo-card" key=${i}><${Skeleton} w=${160} h=${16} /><div style="height:10px"></div><${Skeleton} w=${240} h=${11} /></div>`)}</div>`
      : !repos.length ? html`<${EmptyState} icon="lock" title=${all ? 'None of your repos have Design Hub set up' : "You don't have access to any Design Hub projects yet"}>
          ${all ? html`You can reach ${all} repo${all === 1 ? '' : 's'}, but none has a <code>design/hub.json</code>. Ask a developer to set it up with Claude.`
            : html`Ask the project owner to add you as a collaborator on the game's GitHub repo, and to install the Design Hub GitHub App on it. Then reload this page.`}
          <div style="margin-top:12px"><button class="btn btn-secondary btn-sm" onClick=${loadRepos}><${Icon} name="refresh" size=${14} />Check again</button></div><//>`
      : html`<div class="repo-grid">${repos.map((r) => html`<${RepoCard} key=${r.full_name} r=${r} />`)}</div>`}
  </div>`;
}
