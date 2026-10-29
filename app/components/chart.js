// Inline-SVG line/bar charts (§6) — thin marks, hairline grid, crosshair/band tooltip, legend, table view.
import { html, cx } from '../lib.js';
import { useMemo, useRef, useState } from '../../vendor/hooks.module.js';
import { Icon } from '../icons.js';
import { formatCell, formatAxis, toNumber } from '../format.js';
import { useElementWidth } from './ui.js';
import { useStore } from '../store.js';
import { repoStore } from '../repo.js';

function niceStep(range, count) {
  const raw = range / Math.max(1, count);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = norm >= 7.5 ? 10 : norm >= 3.5 ? 5 : norm >= 1.5 ? 2 : 1;
  return step * mag;
}
function linearTicks(min, max, count = 5) {
  if (min === max) { max = min + 1; }
  const step = niceStep(max - min, count);
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step * 0.001; v += step) ticks.push(Math.round(v / step) * step);
  return { lo, hi, ticks };
}
function logTicks(min, max) {
  const lo = Math.floor(Math.log10(min));
  const span = Math.max(1, Math.ceil(Math.log10(max)) - lo);
  // at most ~6 labelled decades, so 1 … 1e30 stays readable
  const step = Math.max(1, Math.ceil(span / 6));
  const hi = lo + Math.ceil(span / step) * step;
  const ticks = [];
  for (let e = lo; e <= hi; e += step) ticks.push(Math.pow(10, e));
  return { lo: Math.pow(10, lo), hi: Math.pow(10, hi), ticks };
}

function barPath(x, w, y0, y1) {
  // rounded data-end (4px), square at the baseline
  const hgt = Math.abs(y1 - y0);
  const r = Math.min(4, w / 2, hgt);
  if (hgt < 0.5) return '';
  if (y1 <= y0) {
    return `M${x},${y0}V${y1 + r}Q${x},${y1} ${x + r},${y1}H${x + w - r}Q${x + w},${y1} ${x + w},${y1 + r}V${y0}Z`;
  }
  return `M${x},${y0}V${y1 - r}Q${x},${y1} ${x + r},${y1}H${x + w - r}Q${x + w},${y1} ${x + w},${y1 - r}V${y0}Z`;
}

/** One chart from a view's `charts` (contract §6). `table` = the view json. */
export function Chart({ table, chart, height = 260 }) {
  const wrap = useRef(null);
  const [tableView, setTableView] = useState(false);
  const width = useElementWidth(wrap, tableView); // re-observe the new body after Table → Chart
  const [hover, setHover] = useState(null);
  const cols = table.columns || [];
  const xCol = cols.find((c) => c.key === chart.x) || { key: chart.x, label: chart.x, type: 'text' };
  const series = (chart.series || []).slice(0, 6).map((k, i) => ({
    key: k, i,
    col: cols.find((c) => c.key === k) || { key: k, label: k, type: 'number' },
    color: `var(--series-${i + 1})`,
  }));
  const isBar = chart.type === 'bar';
  const stacked = isBar && !!chart.stacked && series.length > 1;
  const log = !!chart.log;
  const data = useMemo(() => (table.rows || []).map((r) => ({
    key: r._key,
    label: formatCell(xCol, r[chart.x]) || String(r._key),
    vals: series.map((s) => toNumber(r[s.key])),
  })), [table, chart]);

  const n = data.length;
  const yCol = series[0] ? series[0].col : { type: 'number' };
  const geo = useMemo(() => {
    let vals = [];
    if (stacked) data.forEach((d) => { vals.push(d.vals.reduce((a, v) => a + (v > 0 ? v : 0), 0)); vals.push(d.vals.reduce((a, v) => a + (v < 0 ? v : 0), 0)); });
    else data.forEach((d) => d.vals.forEach((v) => { if (v != null) vals.push(v); }));
    if (log) vals = vals.filter((v) => v > 0);
    if (!vals.length) return null;
    let min = Math.min(...vals), max = Math.max(...vals);
    let sc;
    if (log) sc = logTicks(min, max);
    else {
      if (isBar || (min >= 0 && min < max * 0.35)) min = Math.min(0, min);
      if (isBar) max = Math.max(0, max);
      sc = linearTicks(min, max, height > 200 ? 5 : 4);
    }
    const compact = Math.max(...sc.ticks.map((t) => Math.abs(t))) >= 10000;
    const labelW = Math.max(...sc.ticks.map((t) => formatAxis(yCol, t, compact).length)) * 6.6 + 14;
    return { ...sc, left: Math.max(32, Math.round(labelW)), min, max, compact };
  }, [data, log, stacked, isBar, height]);

  const legend = series.length > 1;
  const top = 10, bottom = 26, right = 12;
  const W = Math.max(0, width);
  const H = height;
  const left = geo ? geo.left : 32;
  const plotW = Math.max(10, W - left - right);
  const plotH = Math.max(10, H - top - bottom);
  const band = n ? plotW / n : plotW;
  const yOf = (v) => {
    if (!geo) return top + plotH;
    if (log) {
      const lv = Math.log10(Math.max(v, geo.lo));
      return top + plotH - ((lv - Math.log10(geo.lo)) / (Math.log10(geo.hi) - Math.log10(geo.lo))) * plotH;
    }
    return top + plotH - ((v - geo.lo) / (geo.hi - geo.lo || 1)) * plotH;
  };
  const xOf = (i) => left + band * (i + 0.5);
  const base = log ? top + plotH : yOf(0);

  // x labels: thin out so they never collide
  const avgChars = n ? data.reduce((a, d) => a + Math.min(14, d.label.length), 0) / n : 4;
  const every = Math.max(1, Math.ceil((avgChars * 6.4 + 10) / Math.max(1, band)));

  const onMove = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - r.left;
    const i = Math.floor((px - left) / band);
    setHover(i >= 0 && i < n ? i : null);
  };
  const onKey = (e) => {
    if (e.key === 'ArrowRight') { e.preventDefault(); setHover((h) => (h == null ? 0 : Math.min(n - 1, h + 1))); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); setHover((h) => (h == null ? n - 1 : Math.max(0, h - 1))); }
    else if (e.key === 'Escape') setHover(null);
  };

  let marks = null;
  if (geo && W > 0) {
    if (isBar) {
      const groupW = Math.min(band * 0.74, stacked ? 24 : 24 * series.length + 2 * (series.length - 1));
      const bw = stacked ? Math.min(24, groupW) : Math.max(2, Math.min(24, (groupW - 2 * (series.length - 1)) / series.length));
      marks = data.map((d, i) => {
        const cx0 = xOf(i);
        if (stacked) {
          let pos = 0, neg = 0;
          const segs = [];
          const nonZero = d.vals.map((v, si) => ({ v, si })).filter((x) => x.v);
          nonZero.forEach(({ v, si }, idx) => {
            const from = v > 0 ? pos : neg;
            const to = from + v;
            if (v > 0) pos = to; else neg = to;
            const isEnd = v > 0 ? !nonZero.slice(idx + 1).some((x) => x.v > 0) : !nonZero.slice(idx + 1).some((x) => x.v < 0);
            let y0 = yOf(from), y1 = yOf(to);
            // 2px surface gap between stacked segments
            if (from !== 0) y0 += v > 0 ? -1 : 1;
            if (!isEnd) y1 += v > 0 ? 1 : -1;
            const p = isEnd ? barPath(cx0 - bw / 2, bw, y0, y1) : `M${cx0 - bw / 2},${Math.min(y0, y1)}h${bw}v${Math.max(0, Math.abs(y1 - y0))}h${-bw}Z`;
            segs.push(html`<path key=${si} d=${p} fill=${series[si].color} />`);
          });
          return html`<g key=${d.key} class=${cx('mark', hover != null && hover !== i && 'dim')}>${segs}</g>`;
        }
        const totalW = bw * series.length + 2 * (series.length - 1);
        return html`<g key=${d.key} class=${cx('mark', hover != null && hover !== i && 'dim')}>
          ${d.vals.map((v, si) => (v == null || (log && v <= 0)) ? null : html`<path key=${si} d=${barPath(cx0 - totalW / 2 + si * (bw + 2), bw, base, yOf(v))} fill=${series[si].color} />`)}
        </g>`;
      });
    } else {
      marks = series.map((s) => {
        let d = '';
        let pen = false;
        data.forEach((row, i) => {
          const v = row.vals[s.i];
          if (v == null || (log && v <= 0)) { pen = false; return; }
          d += `${pen ? 'L' : 'M'}${xOf(i).toFixed(1)},${yOf(v).toFixed(1)}`;
          pen = true;
        });
        const showDots = n <= 40;
        return html`<g key=${s.key}>
          <path d=${d} fill="none" stroke=${s.color} stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
          ${showDots && data.map((row, i) => {
            const v = row.vals[s.i];
            if (v == null || (log && v <= 0)) return null;
            return html`<circle key=${i} cx=${xOf(i)} cy=${yOf(v)} r=${hover === i ? 5 : 3.5} fill=${s.color} stroke="var(--chart-surface)" stroke-width="2" />`;
          })}
        </g>`;
      });
    }
  }

  const tip = hover != null && data[hover] && W > 0 ? (() => {
    const d = data[hover];
    const x = xOf(hover);
    const tw = 200;
    const leftPx = x + 14 + tw > W ? x - 14 - tw : x + 14;
    return html`<div class="chart-tip" style=${{ left: Math.max(0, leftPx) + 'px', top: '8px', width: tw + 'px' }} role="status">
      <div class="chart-tip-x">${/^[\d.,]+$/.test(d.label) && xCol.label ? `${xCol.label} ${d.label}` : d.label}</div>
      ${series.map((s) => html`<div class="chart-tip-row" key=${s.key}>
        <span class=${isBar ? 'key-rect' : 'key-line'} style=${{ background: s.color }}></span>
        <b class="chart-tip-v">${d.vals[s.i] == null ? '—' : formatCell({ ...s.col, format: undefined }, d.vals[s.i])}</b>
        <span class="chart-tip-s">${s.col.label || s.key}</span>
      </div>`)}
      ${stacked && html`<div class="chart-tip-row chart-tip-total"><span></span><b class="chart-tip-v">${formatCell({ ...series[0].col, format: undefined }, d.vals.reduce((a, v) => a + (v || 0), 0))}</b><span class="chart-tip-s">Total</span></div>`}
    </div>`;
  })() : null;

  return html`<figure class="chart">
    <figcaption class="chart-head">
      <div class="chart-title">${chart.title || table.title || table.id}</div>
      ${chart.log && html`<span class="badge">log scale</span>`}
      <span class="spacer"></span>
      ${legend && !tableView && html`<div class="chart-legend" aria-hidden="true">
        ${series.map((s) => html`<span class="legend-item" key=${s.key}><span class=${isBar ? 'key-rect' : 'key-line'} style=${{ background: s.color }}></span>${s.col.label || s.key}</span>`)}
      </div>`}
      <button type="button" class="btn btn-ghost btn-xs" aria-pressed=${String(tableView)} onClick=${() => setTableView(!tableView)}>
        <${Icon} name=${tableView ? 'chart' : 'table'} size=${12} /><span>${tableView ? 'Chart' : 'Table'}</span>
      </button>
    </figcaption>
    ${tableView ? html`<div class="dtable-scroll chart-table"><table class="dtable">
        <thead><tr><th scope="col">${xCol.label || xCol.key}</th>${series.map((s) => html`<th scope="col" class="num" key=${s.key}>${s.col.label || s.key}</th>`)}</tr></thead>
        <tbody>${data.map((d) => html`<tr key=${d.key}><td>${d.label}</td>${series.map((s) => html`<td class="num" key=${s.key}>${d.vals[s.i] == null ? '—' : formatCell(s.col, d.vals[s.i])}</td>`)}</tr>`)}</tbody>
      </table></div>`
    : html`<div class="chart-body" ref=${wrap} style=${{ height: H + 'px' }} tabindex="0"
        aria-label=${`${chart.title || table.title}: ${isBar ? 'bar' : 'line'} chart of ${series.map((s) => s.col.label || s.key).join(', ')} by ${xCol.label || xCol.key}. Use arrow keys to read values, or switch to the table view.`}
        onKeyDown=${onKey} onBlur=${() => setHover(null)}>
      ${!geo ? html`<div class="chart-empty muted">No numeric values to chart.</div>` : W > 0 && html`<svg width=${W} height=${H} viewBox=${`0 0 ${W} ${H}`} class="chart-svg"
          onPointerMove=${onMove} onPointerLeave=${() => setHover(null)} role="img" aria-hidden="true">
        ${geo.ticks.map((t) => html`<g key=${'t' + t}>
          <line x1=${left} x2=${W - right} y1=${yOf(t)} y2=${yOf(t)} class=${t === 0 && !log ? 'axis-line' : 'grid-line'} />
          <text x=${left - 8} y=${yOf(t)} dy="0.32em" text-anchor="end" class="axis-text">${formatAxis(yCol, t, geo.compact)}</text>
        </g>`)}
        ${!isBar && hover != null && html`<line x1=${xOf(hover)} x2=${xOf(hover)} y1=${top} y2=${top + plotH} class="crosshair" />`}
        ${isBar && hover != null && html`<rect x=${left + band * hover} y=${top} width=${band} height=${plotH} class="band-hl" />`}
        ${marks}
        <line x1=${left} x2=${W - right} y1=${top + plotH} y2=${top + plotH} class="axis-line" />
        ${data.map((d, i) => (i % every === 0 ? html`<text key=${'x' + i} x=${xOf(i)} y=${top + plotH + 17} text-anchor="middle" class=${cx('axis-text', hover === i && 'is-hover')}>${d.label.length > 14 ? d.label.slice(0, 13) + '…' : d.label}</text>` : null))}
      </svg>`}
      ${tip}
    </div>`}
  </figure>`;
}

// {{chart:VIEW/CHART}} island
export function ChartDirective({ arg }) {
  const [vid, cid] = String(arg || '').split('/');
  const view = useStore(repoStore, (s) => s.views[vid] || null);
  if (!view) return html`<span class="directive-warn"><${Icon} name="alert" size=${12} /> Unknown data table <code>${vid}</code></span>`;
  const ch = (view.charts || []).find((c) => c.id === cid) || (!cid && (view.charts || [])[0]);
  if (!ch) return html`<span class="directive-warn"><${Icon} name="alert" size=${12} /> Unknown chart <code>${arg}</code></span>`;
  return html`<${Chart} table=${view} chart=${ch} />`;
}
