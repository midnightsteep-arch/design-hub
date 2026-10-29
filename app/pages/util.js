// Small helpers shared by the page, discussion and history views.
import { html } from '../lib.js';
import { href } from '../router.js';

/** "Today" / "Yesterday" / "Tuesday, Oct 21" (year added when not this year). */
export function dayLabel(ms) {
  const d = new Date(ms);
  const today = new Date();
  const y = new Date(); y.setDate(today.getDate() - 1);
  const same = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (same(d, today)) return 'Today';
  if (same(d, y)) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
}

/** Group items by day label, keeping order. */
export function groupByDay(items, at) {
  const days = [];
  for (const it of items) {
    const lbl = dayLabel(at(it));
    if (!days.length || days[days.length - 1].label !== lbl) days.push({ label: lbl, items: [] });
    days[days.length - 1].items.push(it);
  }
  return days;
}

/** A leading "# Title" duplicates the page header; drop it when it is (roughly) the page title. */
export function stripLeadingTitle(body, title) {
  const m = /^\s*#\s+(.+?)\s*#*\s*(?:\n|$)/.exec(body || '');
  if (!m) return body;
  const toks = (s) => new Set(String(s).toLowerCase().replace(/&/g, ' and ').split(/[^\p{L}\p{N}]+/u).filter(Boolean));
  const a = toks(m[1]), b = toks(title || '');
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const union = new Set([...a, ...b]).size || 1;
  // "Emberfall — pitch" vs "Pitch": every title word appears in the heading → still a duplicate
  const covered = b.size > 0 && [...b].every((t) => a.has(t));
  return inter / union >= 0.5 || covered ? body.slice(m[0].length) : body;
}

/** Text with "#123" turned into links to that discussion. */
export function withIssueLinks(text) {
  const s = String(text || '');
  const out = [];
  let last = 0;
  for (const m of s.matchAll(/(^|[^\w&])#(\d+)\b/g)) {
    const i = m.index + m[1].length;
    if (i > last) out.push(s.slice(last, i));
    out.push(html`<a href=${href.discussions(Number(m[2]))} class="pg-issue-link">#${m[2]}</a>`);
    last = i + 1 + m[2].length;
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
}

/** Who made a commit, in plain words: {name, actor, claude, engine}. */
export function commitWho(c, parsed) {
  const src = parsed && parsed.source;
  const login = c.author && c.author.login;
  const name = (c.commit && c.commit.author && c.commit.author.name) || login || 'Someone';
  if (src === 'claude') return { name: 'Claude', actor: 'Claude', claude: true, engine: null, login };
  return { name: login || name, actor: login || name, claude: false, engine: src === 'unity' ? 'Unity sync' : src === 'godot' ? 'Godot sync' : null, login };
}
export const commitTime = (c) => Date.parse((c.commit && (c.commit.author || c.commit.committer) || {}).date || '') || 0;
