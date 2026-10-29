// Value rendering shared by grid cells, cards, the drawer and the review dialog (App.html valueHtml / changeHtml).
import { html, cx, plural } from '../lib.js';
import { Icon } from '../icons.js';
import { canonColor, listItems, groupThousands, fmtPlain, isNumType, itemTypeOf, displayText, vecLen } from '../canon.js';

export function Swatch({ hex, size = 16 }) {
  const c = canonColor(hex); if (!c) return null;
  const a = parseInt(c.slice(7, 9), 16) / 255;
  return html`<span class="tn-swatch" style=${{ width: size + 'px', height: size + 'px' }}><i style=${{ background: c.slice(0, 7), opacity: a.toFixed(3) }}></i></span>`;
}

export function Spark({ nums, w = 54, h = 16 }) {
  if (!nums.length) return null;
  const mn = Math.min(...nums), mx = Math.max(...nums), span = mx - mn || 1;
  const pts = nums.map((v, i) => [nums.length === 1 ? w / 2 : (i / (nums.length - 1)) * w, mx === mn ? h / 2 : h - 1 - ((v - mn) / span) * (h - 2)]);
  const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join('');
  const last = pts[pts.length - 1];
  return html`<svg class="tn-spark" width=${w} height=${h} viewBox=${`0 0 ${w} ${h}`} aria-hidden="true">
    <path d=${d + `L${w} ${h}L0 ${h}Z`} class="tn-spark-area" /><path d=${d} class="tn-spark-line" />
    <circle cx=${last[0].toFixed(1)} cy=${last[1].toFixed(1)} r="1.8" class="tn-spark-dot" /></svg>`;
}

const unitOf = (col) => (col.unit ? html`<span class="tn-u">${col.unit}</span>` : null);
export const numText = (s) => groupThousands(String(s));

/** Inline value for a cell/field. cv = canonical value (may be an invalid raw string). */
export function ValueView({ col, cv, editable }) {
  if (cv === null || cv === undefined) return html`<span class="tn-empty">—</span>`;
  switch (col.type) {
    case 'int': case 'float':
      if (!/^-?[\d.]+(e[+-]?\d+)?$/i.test(cv)) return html`<span class="tn-txt tn-mono">${cv}</span>`;
      return html`<span class="tn-n">${numText(cv)}</span>${unitOf(col)}`;
    case 'bool':
      return html`<span class=${cx('tn-switch', cv === 'true' && 'is-on', !editable && 'is-ro')} data-x="bool" role="img" aria-label=${cv === 'true' ? 'On' : 'Off'}></span>`;
    case 'enum':
      if (cv === '') return html`<span class="tn-empty">—</span>`;
      return html`<span class=${cx('tn-pill', !editable && 'is-flat')} data-x=${editable ? 'enum' : undefined}>${cv}${editable && html`<${Icon} name="chevron-down" size=${12} class="tn-car" />`}</span>`;
    case 'flags': {
      if (cv === '') return html`<span class="tn-empty" data-x="flags">None</span>`;
      const fs = cv.split('|');
      return html`<span class="tn-flags" data-x="flags">${fs.slice(0, 2).map((f) => html`<span class="tn-pill is-flat">${f}</span>`)}${fs.length > 2 && html`<span class="muted">+${fs.length - 2}</span>`}</span>`;
    }
    case 'color':
      if (cv === '') return html`<span class="tn-empty">—</span>`;
      return html`<${Swatch} hex=${cv} /><span class="tn-mono">${cv.slice(7) === 'FF' ? cv.slice(0, 7) : cv}</span>`;
    case 'vector2': case 'vector3': case 'vector4': {
      const vs = listItems(cv) || [];
      return html`<span class="tn-vec">${vs.map((x, i) => html`${i > 0 && html`<i>,</i> `}${numText(fmtPlain(x))}`)}</span>${unitOf(col)}`;
    }
    case 'list': {
      const items = listItems(cv) || [], it = itemTypeOf(col);
      if (!items.length) return html`<span class="tn-lines" data-x="list"><span class="tn-c">0</span><span class="tn-empty">Empty</span></span>`;
      if (isNumType(it)) return html`<span class="tn-sparkcell" data-x="list"><${Spark} nums=${items.map(Number)} /><span class="tn-c">${items.length}</span></span>`;
      if (it === 'color') return html`<span class="tn-lines" data-x="list"><span class="tn-c">${items.length}</span>${items.slice(0, 6).map((h) => html`<${Swatch} hex=${h} size=${14} />`)}</span>`;
      return html`<span class="tn-lines" data-x="list"><span class="tn-c">${it === 'string' ? plural(items.length, 'line') : items.length}</span><span class="tn-p">${it === 'string' ? String(items[0]).split('\n')[0] : items.join(', ')}</span></span>`;
    }
    case 'ref':
      return html`<span class="tn-ref"><${Icon} name="link" size=${12} /><span>${cv === '' ? 'None' : cv.replace(/^res:\/\//, '')}</span></span>`;
    case 'string': {
      if (cv === '') return html`<span class="tn-empty">—</span>`;
      const ml = col.multiline || cv.includes('\n');
      return html`<span class=${cx('tn-txt', ml && 'is-ml')}>${ml ? cv.replace(/\n+/g, ' ') : cv}</span>`;
    }
    default: return html`<span class="tn-txt">${cv}</span>`;
  }
}

/** "old → new" with a delta chip for numbers; chips for lists; swatches for colours. */
export function ChangeView({ col, from, to, compact }) {
  const t = col.type;
  if (isNumType(t)) {
    const a = Number(from), b = Number(to);
    let dl = null;
    if (isFinite(a) && isFinite(b) && a !== 0) { const pct = (b / a - 1) * 100; dl = html`<span class=${cx('tn-dl', pct >= 0 ? 'is-up' : 'is-dn')}>${(pct >= 0 ? '+' : '') + (Math.abs(pct) < 10 ? pct.toFixed(1) : Math.round(pct))}%</span>`; }
    return html`<span class="tn-chg"><span class="tn-o">${displayText(col, from)}</span><span class="tn-a">→</span><span class="tn-nw">${displayText(col, to)}</span>${dl}</span>`;
  }
  if (t === 'color') return html`<span class="tn-chg"><${Swatch} hex=${from} size=${14} /><span class="tn-o tn-mono">${from}</span><span class="tn-a">→</span><${Swatch} hex=${to} size=${14} /><span class="tn-nw tn-mono">${to}</span></span>`;
  if (t === 'list' && !compact) {
    const A = listItems(from) || [], B = listItems(to) || [], it = itemTypeOf(col), chips = [];
    let more = 0;
    const f = isNumType(it) ? (x) => numText(fmtPlain(x)) : (x) => String(x).slice(0, 24);
    for (let j = 0; j < Math.max(A.length, B.length); j++) {
      if (j < A.length && j < B.length && A[j] === B[j]) continue;
      if (chips.length >= 12) { more++; continue; }
      if (j >= A.length) chips.push(html`<span class="is-add">#${j} ${f(B[j])}</span>`);
      else if (j >= B.length) chips.push(html`<span class="is-rem">#${j} ${f(A[j])}</span>`);
      else chips.push(html`<span class="is-chd">#${j} ${f(A[j])} → ${f(B[j])}</span>`);
    }
    const changedN = chips.length + more;
    if (more) chips.push(html`<span>+${more} more</span>`);
    return html`<div class="tn-chg-list"><span class="muted">${A.length === B.length ? plural(changedN, 'item') + ' changed' : `${A.length} → ${B.length} items`}</span><div class="tn-ldiff">${chips}</div></div>`;
  }
  if (t === 'string' && !compact && (String(from).length > 40 || String(to).length > 40 || String(from).includes('\n') || String(to).includes('\n'))) {
    return html`<div class="tn-tdiff"><div class="tn-o">${from || '(empty)'}</div><div class="tn-nw">${to || '(empty)'}</div></div>`;
  }
  return html`<span class="tn-chg"><span class="tn-o">${displayText(col, from, compact ? 40 : 80)}</span><span class="tn-a">→</span><span class="tn-nw">${displayText(col, to, compact ? 40 : 80)}</span></span>`;
}

/** Small open-thread count badge. */
export function ThreadBadge({ n, onClick, title }) {
  if (!n) return null;
  return html`<button type="button" class="tn-thread" onMouseDown=${(e) => e.stopPropagation()} onClick=${(e) => { e.stopPropagation(); onClick && onClick(e); }}
    title=${title || `${plural(n, 'open discussion')} — click to open`} aria-label=${`${plural(n, 'open discussion')}`}><${Icon} name="comment" size=${11} />${n}</button>`;
}
export { vecLen };
