// Assets section (contract §7, §12): #/<o>/<r>/assets[/<groupId>]?status=&q=&asset=
//  - no group: overview of every review group (progress, counts) + status chips / search across all groups;
//    with a filter set, the matching rows of every group are listed below the cards.
//  - a group: its review table (filters in the URL).
//  - ?asset=<id> opens the asset detail over either.
// AssetGroupEmbed renders the {{assets:GROUP_ID}} page directive (compact table, same row actions).
import { html, cx, STATUS, fmtInt, plural, KIND_ICON, sumCounts } from '../lib.js';
import { useEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { Icon } from '../icons.js';
import { useStore } from '../store.js';
import { href, setQuery, useRoute } from '../router.js';
import { repoStore } from '../repo.js';
import { useViewAssets, useCanEdit, countStatuses, matchesQuery } from '../assets.js';
import { AssetGroupTable } from '../components/assettable.js';
import { AssetDetailOverlay } from '../components/assetdetail.js';
import { StatusChips, ProgressBar } from '../components/status.js';
import { EmptyState, useDebounced } from '../components/ui.js';

// search box ⇄ ?q= (debounced; the URL wins when it changes from outside: back/forward, links)
function useQueryText(query) {
  const [qInput, setQInput] = useState(query.q || '');
  const q = useDebounced(qInput.trim(), 180);
  const pushed = useRef(query.q || '');
  useEffect(() => { if ((query.q || '') !== q) { pushed.current = q; setQuery({ q: q || null }); } }, [q]);
  useEffect(() => { if ((query.q || '') !== pushed.current) { pushed.current = query.q || ''; setQInput(query.q || ''); } }, [query.q]);
  return [qInput, setQInput, (query.q || '').trim()];
}

function SearchBox({ value, onInput, label = 'Search assets' }) {
  return html`<label class="search-input as-search">
    <${Icon} name="search" size=${15} />
    <input class="input" type="search" placeholder="Search name, path, text, notes…" value=${value} onInput=${(e) => onInput(e.currentTarget.value)} aria-label=${label} />
  </label>`;
}

export function AssetsView({ groupId, query = {} }) {
  const groups = useStore(repoStore, (s) => s.groups);
  const all = useViewAssets();
  const readOnly = !useCanEdit();
  const status = STATUS[query.status] ? query.status : '';
  const [qInput, setQInput, q] = useQueryText(query);
  const close = () => setQuery({ asset: null });
  const overlay = query.asset ? html`<${AssetDetailOverlay} key=${query.asset} id=${query.asset} onClose=${close} />` : null;

  if (groupId) {
    const g = groups.find((x) => x.id === groupId);
    if (!g) {
      return html`<div class="container container-wide as-view">
        <${EmptyState} icon="filter" title=${`There's no asset group called “${groupId}”`}>It may have been renamed or removed. <a href=${href.assets()}>See all asset groups</a><//>
        ${overlay}
      </div>`;
    }
    const list = all.filter((a) => a.group === g.id);
    const counts = countStatuses(list);
    return html`<div class="container container-wide as-view">
      <header class="page-head as-head">
        <div class="page-head-main">
          <div class="eyebrow as-eyebrow"><a href=${href.assets()}>Assets</a></div>
          <h1 class="page-title">${g.title}</h1>
          <div class="page-sub">${g.description ? html`<span>${g.description}</span> · ` : ''}${plural(list.length, 'asset')} · <b>${fmtInt(counts.pending_review)}</b> pending · ${fmtInt(counts.approved)} approved</div>
        </div>
        <div class="page-head-actions as-head-actions"><${SearchBox} value=${qInput} onInput=${setQInput} label=${`Search ${g.title}`} /></div>
      </header>
      <${AssetGroupTable} key=${g.id} group=${g} assets=${list} status=${status} onStatus=${(s) => setQuery({ status: s || null })} q=${q}
        mode="page" lazy=${false} readOnly=${readOnly} />
      ${overlay}
    </div>`;
  }

  // ------------------------------------------------ overview
  const searched = q ? all.filter((a) => matchesQuery(a, q)) : all;
  const counts = countStatuses(searched);
  const filtering = !!(status || q);
  const sections = groups.map((g) => ({ g, list: all.filter((a) => a.group === g.id) }));
  const orphans = all.filter((a) => !groups.some((g) => g.id === a.group));
  if (orphans.length) sections.push({ g: { id: '_other', title: 'Other assets' }, list: orphans });
  const matching = sections.map((s) => ({ ...s, n: s.list.filter((a) => matchesQuery(a, q) && (!status || a.status === status)).length }));
  return html`<div class="container container-wide as-view">
    <header class="page-head as-head">
      <div class="page-head-main">
        <h1 class="page-title">Assets</h1>
        <div class="page-sub">${plural(all.length, 'asset')} in ${plural(groups.length, 'group')} · <b>${fmtInt(countStatuses(all).pending_review)}</b> pending review · ${fmtInt(countStatuses(all).approved)} approved</div>
      </div>
    </header>
    ${!all.length ? html`<${EmptyState} icon="image" title="No assets in review yet">A developer adds sprites, UI graphics and text to review by running the asset refresh from the game's manifests. Once they're here, every one shows up for review.<//>`
      : html`
        ${sumCounts(counts) > 0 && html`<${ProgressBar} counts=${counts} height=${6} class="review-progress" label="All assets" showLegend=${true} />`}
        <div class="filter-row as-filter-row" role="search">
          <${SearchBox} value=${qInput} onInput=${setQInput} />
          <${StatusChips} counts=${counts} value=${status} onChange=${(s) => setQuery({ status: s || null })} />
          ${filtering && html`<button type="button" class="btn btn-ghost btn-sm" onClick=${() => { setQInput(''); setQuery({ status: null, q: null }); }}>
            <${Icon} name="x" size=${14} /><span class="btn-label">Clear</span></button>`}
        </div>
        <div class="as-groups">
          ${sections.map(({ g, list }) => html`<${GroupCard} key=${g.id} g=${g} list=${list} q=${q} status=${status} />`)}
        </div>
        ${filtering && html`<h2 class="as-results-title">${(() => { const n = matching.reduce((t, s) => t + s.n, 0); return n ? `${plural(n, 'matching asset')}` : 'Nothing matches'; })()}
            ${status && html`<span class="muted"> · ${STATUS[status].label}</span>`}${q && html`<span class="muted"> · “${q}”</span>`}</h2>
          ${matching.filter((s) => s.n > 0).map(({ g, list }, i) => html`<${AssetGroupTable} key=${g.id} group=${g} assets=${list} status=${status} q=${q}
              onStatus=${(s) => setQuery({ status: s || null })} mode="hub" lazy=${i > 1} readOnly=${readOnly} />`)}
          ${!matching.some((s) => s.n > 0) && html`<${EmptyState} compact icon="filter" title="Nothing matches these filters">
            <button type="button" class="link-btn" onClick=${() => { setQInput(''); setQuery({ status: null, q: null }); }}>Clear filters</button><//>`}`}`}
    ${overlay}
  </div>`;
}

function GroupCard({ g, list, q, status }) {
  const c = countStatuses(q ? list.filter((a) => matchesQuery(a, q)) : list);
  const total = list.length;
  const pct = total ? Math.round((countStatuses(list).approved / total) * 100) : 0;
  const link = href.assets(g.id === '_other' ? null : g.id, { status: status || undefined, q: q || undefined });
  return html`<a class=${cx('card as-group-card', status && !c[status] && 'is-dim')} href=${link}>
    <div class="as-gc-head">
      <span class="as-gc-icon"><${Icon} name=${KIND_ICON[g.kind] || 'image'} size=${16} /></span>
      <span class="as-gc-title">${g.title}</span>
      <span class="as-gc-pct mono" title="Approved">${pct}%</span>
    </div>
    ${g.description && html`<p class="as-gc-desc">${g.description}</p>`}
    <${ProgressBar} counts=${c} label=${g.title} />
    <div class="as-gc-counts">
      ${['pending_review', 'needs_replacement', 'replaced', 'approved'].map((k) => html`<span key=${k} class=${cx('as-gc-count', 'tone-' + STATUS[k].cls, !c[k] && 'is-zero')} title=${STATUS[k].label}>
        <${Icon} name=${STATUS[k].icon} size=${12} /><b>${fmtInt(c[k])}</b><span class="as-gc-count-l">${STATUS[k].short}</span></span>`)}
    </div>
    <div class="as-gc-foot muted">${plural(total, 'asset')}<span class="spacer"></span><span class="as-gc-open">Review <${Icon} name="arrow-right" size=${12} /></span></div>
  </a>`;
}

// ---------------------------------------------------------------- {{assets:GROUP_ID}} directive
const overlayOwner = new Map(); // groupId -> the first embed of that group on the page renders the detail overlay
export function AssetGroupEmbed({ groupId }) {
  const groups = useStore(repoStore, (s) => s.groups);
  const list = useViewAssets(groupId);
  const readOnly = !useCanEdit();
  const route = useRoute();
  const tok = useRef({});
  if (!overlayOwner.has(groupId)) overlayOwner.set(groupId, tok.current);
  useEffect(() => () => { if (overlayOwner.get(groupId) === tok.current) overlayOwner.delete(groupId); }, [groupId]);
  const g = groups.find((x) => x.id === groupId);
  if (!g) {
    return html`<span class="directive-warn" role="note"><${Icon} name="alert" size=${12} /> Unknown asset group <code>${groupId}</code></span>`;
  }
  const openId = route.query && route.query.asset;
  const showOverlay = openId && route.section !== 'assets' && overlayOwner.get(groupId) === tok.current && list.some((a) => a.id === openId);
  return html`<div class="as-embed-wrap">
    <${AssetGroupTable} group=${g} assets=${list} mode="embed" lazy=${true} readOnly=${readOnly} />
    ${showOverlay && html`<${AssetDetailOverlay} key=${openId} id=${openId} onClose=${() => setQuery({ asset: null })} />`}
  </div>`;
}
