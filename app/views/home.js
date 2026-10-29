// Project home: what the project is, where to go, what needs attention, what changed lately.
import { html, relTime, fullTime, plural } from '../lib.js';
import { useEffect, useState } from '../../vendor/hooks.module.js';
import { Icon, iconExists } from '../icons.js';
import { useStore } from '../store.js';
import { repoStore } from '../repo.js';
import * as G from '../github.js';
import { discussStore } from '../discuss.js';
import { parseCommitMessage } from '../commitmsg.js';
import { href } from '../router.js';
import { ProgressBar } from '../components/status.js';
import { Avatar, SkeletonLines } from '../components/ui.js';
import { groupCounts, tuningGroups } from '../components/nav.js';

function Recent() {
  const head = useStore(repoStore, (s) => s.head);
  const [list, setList] = useState(null);
  useEffect(() => {
    let alive = true;
    const { owner, repo, branch, designRoot } = repoStore.get();
    G.listCommits(owner, repo, { sha: head || branch, path: designRoot, perPage: 6 }).then((r) => { if (alive) setList(r.commits); }).catch(() => { if (alive) setList([]); });
    return () => { alive = false; };
  }, [head]);
  if (!list) return html`<${SkeletonLines} lines=${4} />`;
  if (!list.length) return html`<p class="muted card-empty">No changes yet.</p>`;
  return html`<ul class="mini-feed">${list.map((c) => {
    const m = parseCommitMessage(c.commit.message);
    const who = m.source === 'claude' ? 'Claude' : (c.author && c.author.login) || c.commit.author.name;
    const at = Date.parse(c.commit.author.date);
    return html`<li key=${c.sha}><${Avatar} actor=${who} size=${20} />
      <span class="mini-feed-text"><b>${who}</b> ${m.summary}</span>
      <time class="muted" title=${fullTime(at)}>${relTime(at)}</time></li>`;
  })}</ul>`;
}

export function HomeView() {
  const hub = useStore(repoStore, (s) => s.hub);
  const schema = useStore(repoStore, (s) => s.schema);
  const groups = useStore(repoStore, (s) => s.groups);
  const assets = useStore(repoStore, (s) => s.assets);
  useStore(repoStore, (s) => s.reviews);
  const pages = useStore(repoStore, (s) => s.pages);
  const threads = useStore(discussStore, (s) => s.threads);
  const p = hub.project || {};
  const open = (threads || []).filter((t) => t.open);
  const proposals = open.filter((t) => t.target.type === 'cell' && t.target.to != null);
  const links = ((p.settings && p.settings.links) || []).filter((l) => /^https?:\/\//.test(l.url || ''));
  const tg = tuningGroups(hub, schema);
  return html`<div class="container home">
    <header class="home-hero">
      <h1 class="page-title">${p.name || repoStore.get().repo}</h1>
      ${p.tagline && html`<p class="page-sub">${p.tagline}</p>`}
      <div class="home-meta muted">
        ${p.engine && html`<span class="badge badge-neutral">${p.engine === 'godot' ? 'Godot' : p.engine === 'unity' ? 'Unity' : p.engine}${p.engineVersion ? ' ' + p.engineVersion : ''}</span>`}
        <span>${repoStore.get().key}</span>
        ${links.map((l) => html`<a href=${l.url} target="_blank" rel="noopener noreferrer"><${Icon} name="external" size=${12} /> ${l.label || l.url}</a>`)}
      </div>
    </header>
    <div class="home-grid">
      <section class="card">
        <div class="card-head"><h2 class="card-title"><${Icon} name="book" size=${15} />Design docs</h2></div>
        ${(hub.tabs || []).map((t) => html`<div class="home-tab" key=${t.id}>
          <div class="home-tab-title"><${Icon} name=${iconExists(t.icon) ? t.icon : 'file-text'} size=${14} />${t.title}</div>
          <ul class="home-links">${(t.pages || []).map((pg) => html`<li key=${pg.id}><a href=${href.page(pg.id)}>${pg.title}</a></li>`)}</ul>
        </div>`)}
        ${!pages.length && html`<p class="muted card-empty">No pages yet.</p>`}
      </section>
      ${schema && html`<section class="card">
        <div class="card-head"><h2 class="card-title"><${Icon} name="sliders" size=${15} />Tuning</h2><a class="card-link" href=${href.tuning()}>All tables <${Icon} name="arrow-right" size=${12} /></a></div>
        ${tg.map((g) => html`<div class="home-tab" key=${g.name}><div class="home-tab-title">${g.name}</div>
          <ul class="home-links">${g.tables.map((t) => html`<li key=${t.id}><a href=${href.tuning(t.id)}>${t.label || t.id}</a></li>`)}</ul></div>`)}
      </section>`}
      ${groups.length > 0 && html`<section class="card">
        <div class="card-head"><h2 class="card-title"><${Icon} name="image" size=${15} />Asset review</h2><a class="card-link" href=${href.assets()}>Review <${Icon} name="arrow-right" size=${12} /></a></div>
        <div class="tab-progress">${groups.map((g) => { const c = groupCounts(g.id, assets); return html`<a class="tp-group" href=${href.assets(g.id)} key=${g.id}>
          <span class="tp-name">${g.title || g.id}</span><${ProgressBar} counts=${c} height=${6} />
          <span class="tp-nums"><b>${c.approved}</b><span class="muted">/${c.total} approved${c.pending_review ? ` · ${c.pending_review} to review` : ''}</span></span></a>`; })}</div>
      </section>`}
      <section class="card">
        <div class="card-head"><h2 class="card-title"><${Icon} name="comment" size=${15} />Discussions</h2><a class="card-link" href=${href.discussions()}>All <${Icon} name="arrow-right" size=${12} /></a></div>
        ${!threads ? html`<${SkeletonLines} lines=${3} />` : !open.length ? html`<p class="muted card-empty">Nothing open. Comment on a page, a value or an asset to start one.</p>`
          : html`<p class="muted" style="margin:0 0 8px">${plural(open.length, 'open thread')}${proposals.length ? ` · ${plural(proposals.length, 'proposal')} waiting` : ''}</p>
            <ul class="home-links">${open.slice(0, 5).map((t) => html`<li key=${t.number}><a href=${href.discussions(t.number)}>#${t.number} ${t.title}</a></li>`)}</ul>`}
      </section>
      <section class="card home-wide">
        <div class="card-head"><h2 class="card-title"><${Icon} name="history" size=${15} />Recent changes</h2><a class="card-link" href=${href.history()}>History <${Icon} name="arrow-right" size=${12} /></a></div>
        <${Recent} />
      </section>
    </div>
  </div>`;
}
