// Change feed entries built from commits touching design/ (contract §8 commit messages):
// who, summary, cell changes, asset status changes, page edits, note, issue links.
import { html, cx, relTime, fullTime } from '../lib.js';
import { Icon } from '../icons.js';
import { Avatar } from './ui.js';
import { StatusPill } from './status.js';
import { href } from '../router.js';
import { parseCommitMessage } from '../commitmsg.js';
import { displayText } from '../canon.js';
import { schemaTable, rowName, assetById, pageById } from '../repo.js';
import { commitWho, commitTime, withIssueLinks } from '../pages/util.js';

const KNOWN_LINE = /^(Hub-Source:|Note: |page\|[^:]+:|asset\|[^|]+\|.+?: |[^|\s][^|]*\|[^|]+\|[^:|]+: )/;
/** Body lines a person wrote that the parser didn't turn into structured changes. */
function extraLines(message, parsed) {
  const lines = String(message || '').replace(/\r\n/g, '\n').split('\n').slice(1).map((l) => l.trimEnd()).filter((l) => l.trim());
  if (!parsed.hub) return lines;
  return lines.filter((l) => !KNOWN_LINE.test(l));
}

function fmtVal(col, v) {
  if (v == null) return html`<span class="pg-empty-val">(empty)</span>`;
  const s = col ? displayText(col, v, 40) : String(v);
  return s === '' ? html`<span class="pg-empty-val">(blank)</span>` : html`<span class="pg-val">${s}</span>`;
}

export function CellChange({ c, link = true }) {
  const st = schemaTable(c.table);
  const col = st && st.columns.find((x) => x.id === c.column);
  const label = st ? st.label || st.id : c.table;
  const where = html`<span class="pg-ch-where">${label} · <b>${rowName(c.table, c.key)}</b> · ${col ? col.label || col.id : c.column}</span>`;
  return html`<li class="pg-ch pg-ch-cell">
    <${Icon} name="sliders" size=${12} class="pg-ch-icon" />
    ${link ? html`<a href=${href.tuning(c.table, { row: c.key })} class="pg-ch-link">${where}</a>` : where}
    <span class="pg-ch-vals">${fmtVal(col, c.from)}<${Icon} name="arrow-right" size=${11} class="muted" />${fmtVal(col, c.to)}</span>
  </li>`;
}

function AssetChange({ a }) {
  // tolerate "asset|<id>|status: …" lines (group missing) as well as the contract's "asset|<group>|<id>: …"
  let asset = assetById(a.id);
  if (!asset && assetById(a.group)) asset = assetById(a.group);
  const id = asset ? asset.id : a.id;
  const isStatus = (v) => v == null || /^(pending_review|needs_replacement|replaced|approved)$/.test(v);
  return html`<li class="pg-ch pg-ch-asset">
    <${Icon} name="image" size=${12} class="pg-ch-icon" />
    ${asset ? html`<a href=${href.asset(asset.id, asset.group)} class="pg-ch-link"><b>${asset.name || asset.id}</b></a>` : html`<span class="mono">${id}</span>`}
    <span class="pg-ch-vals">
      ${isStatus(a.from) && a.from ? html`<${StatusPill} status=${a.from} size="sm" />` : html`<span class="pg-val">${a.from == null ? '(none)' : a.from}</span>`}
      <${Icon} name="arrow-right" size=${11} class="muted" />
      ${isStatus(a.to) && a.to ? html`<${StatusPill} status=${a.to} size="sm" />` : html`<span class="pg-val">${a.to == null ? '(none)' : a.to}</span>`}
    </span>
  </li>`;
}

function PageChange({ p }) {
  const page = pageById(p.id);
  return html`<li class="pg-ch pg-ch-page">
    <${Icon} name="file-text" size=${12} class="pg-ch-icon" />
    ${page ? html`<a href=${href.page(p.id)} class="pg-ch-link"><b>${page.title}</b></a>` : html`<span class="mono">${p.id}</span>`}
    <span class="muted">${p.what || 'edited'}</span>
  </li>`;
}

/**
 * One change (commit) in the activity feed.
 * props: commit (GitHub commit list item), cellFilter(c) → bool (only show matching cells), compact.
 */
export function CommitItem({ commit, cellFilter, compact }) {
  const m = parseCommitMessage(commit.commit.message);
  const who = commitWho(commit, m);
  const at = commitTime(commit);
  const cells = cellFilter ? m.cells.filter(cellFilter) : m.cells;
  const hidden = m.cells.length - cells.length;
  const extra = extraLines(commit.commit.message, m);
  const icon = m.cells.length ? 'sliders' : m.assets.length ? 'image' : m.pages.length ? 'edit' : who.engine ? 'refresh' : 'commit';
  return html`<li class=${cx('pg-commit', compact && 'is-compact')}>
    <span class="pg-commit-av"><${Avatar} actor=${who.actor} size=${28} /></span>
    <div class="pg-commit-main">
      <div class="pg-commit-head">
        <span class="pg-commit-who">${who.name}</span>
        ${who.engine && html`<span class="badge badge-accent pg-engine"><${Icon} name="refresh" size=${10} /> ${who.engine}</span>`}
        ${!m.hub && html`<span class="badge badge-neutral" title="Not made through Design Hub">Outside the hub</span>`}
        <span class="spacer"></span>
        <time class="pg-commit-time muted" title=${fullTime(at)} datetime=${at ? new Date(at).toISOString() : undefined}>${relTime(at)}</time>
      </div>
      <div class="pg-commit-sum"><${Icon} name=${icon} size=${13} class="muted" /><span>${withIssueLinks(m.summary)}</span></div>
      ${(cells.length > 0 || m.assets.length > 0 || m.pages.length > 0) && html`<ul class="pg-changes">
        ${cells.slice(0, 12).map((c, i) => html`<${CellChange} key=${'c' + i} c=${c} />`)}
        ${cells.length > 12 && html`<li class="pg-ch muted">…and ${cells.length - 12} more value${cells.length - 12 === 1 ? '' : 's'}</li>`}
        ${hidden > 0 && html`<li class="pg-ch muted">+ ${hidden} other value${hidden === 1 ? '' : 's'} in this change</li>`}
        ${m.assets.map((a, i) => html`<${AssetChange} key=${'a' + i} a=${a} />`)}
        ${m.pages.map((p, i) => html`<${PageChange} key=${'p' + i} p=${p} />`)}
      </ul>`}
      ${m.note && html`<div class="pg-commit-note"><${Icon} name="comment" size=${12} class="muted" /><span>${withIssueLinks(m.note)}</span></div>`}
      ${!compact && extra.length > 0 && html`<div class="pg-commit-extra muted">${extra.slice(0, 6).map((l, i) => html`<div key=${i}>${withIssueLinks(l)}</div>`)}</div>`}
      ${!compact && commit.html_url && html`<a class="pg-commit-gh" href=${commit.html_url} target="_blank" rel="noopener noreferrer"><${Icon} name="github" size=${12} /> View on GitHub</a>`}
    </div>
  </li>`;
}
