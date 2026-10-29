// {{tuning:TABLE_ID}} inside markdown pages: the same editor in a compact frame (inline editing, staging,
// proposals) with a link to the full table in the Tuning section.
import { html, cx, plural } from '../lib.js';
import { useState } from '../../vendor/hooks.module.js';
import { Icon } from '../icons.js';
import { useStore } from '../store.js';
import { repoStore, schemaTable, tableRows } from '../repo.js';
import { href } from '../router.js';
import { Segmented } from '../components/ui.js';
import { useEntries, currentValue, useUndoKeys } from './staging.js';
import { sectionTable, sectionList } from './model.js';
import { countOf } from './model.js';
import { TableBody, SearchBox } from './view.js';

export function TuningEmbed({ tableId }) {
  const status = useStore(repoStore, (s) => s.status);
  useStore(repoStore, (s) => s.version);
  const entries = useEntries();
  const t = status === 'ready' ? schemaTable(tableId) : null;
  const [view, setView] = useState(null);
  const [text, setText] = useState('');
  const [section, setSection] = useState(null);
  useUndoKeys();
  if (status !== 'ready') return html`<div class="tn-embed is-loading"><span class="skel" style="width:100%;height:120px;display:block"></span></div>`;
  if (!t) return html`<span class="tn-embed-warn" role="note"><${Icon} name="alert" size=${13} /> Unknown tuning table “${tableId}”</span>`;
  const v = view || (t.defaultView === 'cards' ? 'cards' : 'grid');
  const secs = sectionTable(tableId) ? sectionList(tableId, currentValue) : null;
  const sec = secs && section != null && secs.some((s) => s.value === section) ? section : null;
  const n = Object.values(entries).filter((e) => e.table === tableId).length;
  return html`<div class=${cx('tn-embed', v === 'cards' && 'is-cards')} data-table=${tableId}>
    <div class="tn-embed-head">
      <span class="tn-embed-title"><${Icon} name="sliders" size=${15} /><b>${t.label || t.id}</b><span class="muted">${countOf(tableRows(tableId).length, t.rowLabel)}</span>
        ${n > 0 && html`<span class="badge badge-accent">${plural(n, 'unsaved change')}</span>`}</span>
      <span class="grow"></span>
      <${SearchBox} value=${text} onInput=${setText} small=${true} placeholder="Filter…" />
      <${Segmented} label="View" size="sm" value=${v} onChange=${setView} options=${[{ value: 'grid', icon: 'table', title: 'Grid' }, { value: 'cards', icon: 'layout', title: 'Cards' }]} />
      <a class="btn btn-sm btn-ghost tn-embed-open" href=${href.tuning(tableId, sec != null ? { s: sec === '' ? '(none)' : sec } : undefined)}>Open in Tuning<${Icon} name="arrow-up-right" size=${13} /></a>
    </div>
    ${secs && secs.length > 1 && html`<div class="tn-sectabs is-small" role="tablist" aria-label="Sections">
      <button type="button" role="tab" aria-selected=${String(sec == null)} class=${cx('tn-sectab', sec == null && 'is-on')} onClick=${() => setSection(null)}>All<span class="tn-cnt">${tableRows(tableId).length}</span></button>
      ${secs.map((s) => html`<button type="button" role="tab" key=${s.value} aria-selected=${String(sec === s.value)} class=${cx('tn-sectab', sec === s.value && 'is-on')} onClick=${() => setSection(s.value)}>${s.name}<span class="tn-cnt">${s.count}</span></button>`)}
    </div>`}
    <div class="tn-embed-body"><${TableBody} tid=${tableId} section=${sec} view=${v} density="compact" compact=${true} text=${text} changedOnly=${false} /></div>
  </div>`;
}
