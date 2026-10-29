// Project sidebar: the hub.json tabs with their pages, then the built-in sections Tuning, Assets,
// Discussions and History (contract §2).
import { html, cx } from '../lib.js';
import { Icon, iconExists } from '../icons.js';
import { useStore } from '../store.js';
import { repoStore, reviewOf } from '../repo.js';
import { discussStore } from '../discuss.js';
import { href } from '../router.js';

/** Tuning groups in sidebar order: hub.tuning.groupOrder, then schema.groups, then the rest. */
export function tuningGroups(hub, schema) {
  if (!schema) return [];
  const roots = (schema.tables || []).filter((t) => !t.parent);
  const order = [...((hub && hub.tuning && hub.tuning.groupOrder) || []), ...(schema.groups || [])];
  const names = [];
  for (const g of order) if (!names.includes(g)) names.push(g);
  for (const t of roots) { const g = t.group || 'Other'; if (!names.includes(g)) names.push(g); }
  return names.map((g) => ({ name: g, tables: roots.filter((t) => (t.group || 'Other') === g).sort((a, b) => (a.order || 0) - (b.order || 0) || String(a.label || a.id).localeCompare(String(b.label || b.id))) }))
    .filter((g) => g.tables.length);
}

/** Section values of a table with sectionBy, in sectionOrder order (else alphabetical, empty last). */
export function sectionsOf(table, rows) {
  if (!table || !table.sectionBy) return [];
  const vals = new Set();
  for (const r of rows || []) vals.add(String((r.values || {})[table.sectionBy] ?? ''));
  const order = table.sectionOrder || [];
  return [...vals].sort((a, b) => {
    const ia = order.indexOf(a), ib = order.indexOf(b);
    if (ia >= 0 || ib >= 0) return (ia < 0 ? 1e9 : ia) - (ib < 0 ? 1e9 : ib);
    if (!a) return 1; if (!b) return -1;
    return a.localeCompare(b);
  });
}

export function groupCounts(groupId, assets) {
  const c = { pending_review: 0, needs_replacement: 0, replaced: 0, approved: 0, total: 0 };
  for (const a of assets) {
    if (a.group !== groupId) continue;
    const r = reviewOf(a);
    if (r.archived) continue;
    c[r.status] = (c[r.status] || 0) + 1;
    c.total++;
  }
  return c;
}

function Section({ title, icon, to, active, badge, children }) {
  return html`<div class="nav-section">
    ${to ? html`<a class=${cx('nav-head', active && 'is-active')} href=${to} aria-current=${active ? 'page' : undefined}><${Icon} name=${icon} size=${15} /><span>${title}</span>${badge}</a>`
      : html`<div class="nav-head nav-head-static"><${Icon} name=${icon} size=${15} /><span>${title}</span>${badge}</div>`}
    ${children && html`<ul class="nav-list">${children}</ul>`}
  </div>`;
}
const Item = ({ to, active, children, sub, title }) => html`<li><a class=${cx('nav-link', sub && 'nav-sub', active && 'is-active')} href=${to} title=${title} aria-current=${active ? 'page' : undefined}>${children}</a></li>`;

export function Sidebar({ route }) {
  const hub = useStore(repoStore, (s) => s.hub);
  const schema = useStore(repoStore, (s) => s.schema);
  const tables = useStore(repoStore, (s) => s.tables);
  const groups = useStore(repoStore, (s) => s.groups);
  const assets = useStore(repoStore, (s) => s.assets);
  useStore(repoStore, (s) => s.reviews);
  const threads = useStore(discussStore, (s) => s.threads);
  const openThreads = (threads || []).filter((t) => t.open).length;
  const sec = route.section;
  return html`<nav class="nav">
    ${(hub.tabs || []).map((t) => html`<${Section} key=${t.id} title=${t.title} icon=${iconExists(t.icon) ? t.icon : 'file-text'}>
      ${(t.pages || []).map((p) => html`<${Item} key=${p.id} to=${href.page(p.id)} active=${sec === 'page' && route.id === p.id}>${p.title}<//>`)}
    <//>`)}
    ${schema && html`<${Section} title="Tuning" icon="sliders" to=${href.tuning()} active=${sec === 'tuning' && !route.id}>
      ${tuningGroups(hub, schema).map((g) => html`<li key=${g.name} class="nav-group">${g.name}</li>
        ${g.tables.map((t) => {
          const active = sec === 'tuning' && (route.id === t.id || String(route.id || '').startsWith(t.id + '.'));
          const secs = active ? sectionsOf(t, tables[t.id] && tables[t.id].rows) : [];
          return html`<${Item} key=${t.id} to=${href.tuning(t.id)} active=${active && !route.query.s}>${t.label || t.id}<//>
            ${secs.map((s) => html`<${Item} key=${t.id + ':' + s} sub to=${href.tuning(t.id, { s: s || '(none)' })} active=${active && route.query.s === (s || '(none)')}>${s || 'Unassigned'}<//>`)}`;
        })}`)}
    <//>`}
    ${groups.length > 0 && html`<${Section} title="Assets" icon="image" to=${href.assets()} active=${sec === 'assets' && !route.id}>
      ${groups.map((g) => {
        const c = groupCounts(g.id, assets);
        return html`<${Item} key=${g.id} to=${href.assets(g.id)} active=${sec === 'assets' && route.id === g.id}>
          <span class="nav-text">${g.title || g.id}</span>
          ${c.pending_review ? html`<span class="tab-dot tab-dot-pending" title=${`${c.pending_review} pending review`}>${c.pending_review}</span>`
            : c.needs_replacement ? html`<span class="tab-dot tab-dot-needs" title=${`${c.needs_replacement} need replacement`}>${c.needs_replacement}</span>` : null}
        <//>`;
      })}
    <//>`}
    <${Section} title="Discussions" icon="comment" to=${href.discussions()} active=${sec === 'discussions'}
      badge=${openThreads ? html`<span class="tab-dot tab-dot-neutral" title=${`${openThreads} open`}>${openThreads}</span>` : null} />
    <${Section} title="History" icon="history" to=${href.history()} active=${sec === 'history'} />
  </nav>`;
}
