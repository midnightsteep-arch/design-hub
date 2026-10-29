// Status pill, status select (menu), stacked progress bar, filter chips.
import { html, cx, STATUS, STATUSES, sumCounts, fmtInt } from '../lib.js';
import { Icon } from '../icons.js';
import { Menu } from './overlay.js';
import { useRef, useState } from '../../vendor/hooks.module.js';

export function StatusPill({ status, size, short }) {
  const s = STATUS[status] || STATUS.pending_review;
  return html`<span class=${cx('pill', 'st-' + s.cls, size && 'pill-' + size)}>
    <${Icon} name=${s.icon} size=${size === 'sm' ? 12 : 14} class="pill-icon" />
    <span class="pill-label">${short ? s.short : s.label}</span>
  </span>`;
}

// A pill-shaped button that opens a menu of statuses. `disabledReplaced` when no replacement exists.
export function StatusSelect({ status, onChange, hasReplacement, size, label = 'Status', compact, readOnly, busy }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  if (readOnly) return html`<${StatusPill} status=${status} size=${size} short=${compact} />`;
  const s = STATUS[status] || STATUS.pending_review;
  const items = STATUSES.map((k) => ({
    key: k,
    label: STATUS[k].label,
    icon: STATUS[k].icon,
    iconClass: 'st-ink-' + STATUS[k].cls,
    checked: k === status,
    disabled: k === 'replaced' && !hasReplacement && status !== 'replaced',
    hint: k === 'replaced' && !hasReplacement && status !== 'replaced' ? 'attach one first' : undefined,
    onSelect: () => { if (k !== status) onChange(k); },
  }));
  return html`
    <button type="button" ref=${ref} class=${cx('pill', 'pill-btn', 'st-' + s.cls, size && 'pill-' + size, compact && 'pill-compact', busy && 'is-busy')}
      aria-haspopup="menu" aria-expanded=${String(open)} aria-label=${`${label}: ${s.label}. Change status`}
      onClick=${(e) => { e.stopPropagation(); setOpen((o) => !o); }}
      onKeyDown=${(e) => { if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); } }}>
      <${Icon} name=${s.icon} size=${size === 'sm' ? 12 : 14} class="pill-icon" />
      <span class="pill-label">${compact ? s.short : s.label}</span>
      <${Icon} name="chevron-down" size=${12} class="pill-caret" />
    </button>
    ${open && html`<${Menu} anchor=${ref} onClose=${() => setOpen(false)} items=${items} label="Set status" />`}`;
}

// Stacked horizontal bar of the four statuses; 2px surface gaps between segments.
export function ProgressBar({ counts, height = 6, showLegend, class: cls, label }) {
  const total = sumCounts(counts);
  const done = (counts && counts.approved) || 0;
  const pct = total ? Math.round((done / total) * 100) : 0;
  const order = ['approved', 'replaced', 'needs_replacement', 'pending_review'];
  const title = total
    ? order.map((k) => `${STATUS[k].label}: ${counts[k] || 0}`).join(' · ')
    : 'No assets';
  return html`<div class=${cx('progress', cls)}>
    <div class="progress-track" style=${{ height: height + 'px' }} role="img" aria-label=${(label ? label + ': ' : '') + `${pct}% approved. ` + title} title=${title}>
      ${total ? order.map((k) => {
        const n = (counts && counts[k]) || 0;
        if (!n) return null;
        return html`<span key=${k} class=${'progress-seg seg-' + STATUS[k].cls} style=${{ flexGrow: n, flexBasis: 0 }}></span>`;
      }) : html`<span class="progress-seg seg-empty" style=${{ flexGrow: 1 }}></span>`}
    </div>
    ${showLegend && html`<div class="progress-legend">
      ${order.map((k) => html`<span class="legend-item" key=${k}><span class=${'legend-swatch seg-' + STATUS[k].cls}></span>${STATUS[k].short} <b>${fmtInt((counts && counts[k]) || 0)}</b></span>`)}
    </div>`}
  </div>`;
}

// Filter chips: All / Pending / Needs replacement / Replaced / Approved with counts.
export function StatusChips({ counts, value, onChange, size }) {
  const total = sumCounts(counts);
  const opts = [{ k: '', label: 'All', n: total }, ...STATUSES.map((k) => ({ k, label: STATUS[k].short, n: (counts && counts[k]) || 0, icon: STATUS[k].icon, cls: STATUS[k].cls }))];
  return html`<div class=${cx('chips', size && 'chips-' + size)} role="radiogroup" aria-label="Filter by status">
    ${opts.map((o) => html`<button type="button" key=${o.k || 'all'} role="radio" aria-checked=${String((value || '') === o.k)}
      class=${cx('chip', (value || '') === o.k && 'is-active', o.cls && 'chip-st-' + o.cls)} onClick=${() => onChange(o.k)}>
      ${o.icon && html`<${Icon} name=${o.icon} size=${12} class="chip-icon" />`}
      <span>${o.label}</span><span class="chip-n">${fmtInt(o.n)}</span>
    </button>`)}
  </div>`;
}

export function StatusDot({ status }) {
  const s = STATUS[status];
  return html`<span class=${'st-dot seg-' + (s ? s.cls : 'empty')} aria-hidden="true"></span>`;
}
