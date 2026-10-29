// Open discussion threads on tuning cells and rows (contract §9), indexed for fast badge lookups.
import { html, plural } from '../lib.js';
import { useStore } from '../store.js';
import { Icon } from '../icons.js';
import { Popover } from '../components/overlay.js';
import { discussStore, threadsFor } from '../discuss.js';
import { href, navigate } from '../router.js';

/** {cell: Map("key\u0001col" → threads), row: Map(key → row-level threads), all: Map(key → all threads of the row)} for one table. */
export function useThreadIndex(tid) {
  const threads = useStore(discussStore, (s) => s.threads);
  const list = threadsFor(threads, { type: 'table', table: tid }, { openOnly: true });
  const cell = new Map(), row = new Map(), all = new Map();
  for (const th of list) {
    const t = th.target, k = t.key;
    if (!all.has(k)) all.set(k, []); all.get(k).push(th);
    if (t.type === 'cell') { const ck = k + '\u0001' + t.column; if (!cell.has(ck)) cell.set(ck, []); cell.get(ck).push(th); }
    else if (t.type === 'row') { if (!row.has(k)) row.set(k, []); row.get(k).push(th); }
  }
  return { cell, row, all };
}

/** Open the thread (one) or show a list to choose from (several). */
export function openThreads(list, anchor, setPop) {
  if (!list || !list.length) return;
  if (list.length === 1 || !setPop) { navigate(href.discussions(list[0].number)); return; }
  setPop({ anchor, list });
}

export function ThreadsPop({ pop, onClose }) {
  return html`<${Popover} anchor=${pop.anchor} onClose=${onClose} label="Open discussions" width=${300} class="tn-pop">
    <div class="tn-pop-list">
      <div class="menu-heading">${plural(pop.list.length, 'open discussion')}</div>
      ${pop.list.map((th, i) => html`<a class="menu-item tn-thread-item" href=${href.discussions(th.number)} data-autofocus=${i === 0 || undefined} onClick=${onClose}>
        <${Icon} name=${th.target.to != null ? 'swap' : 'comment'} size=${14} /><span class="menu-label">#${th.number} ${th.title}</span></a>`)}
    </div>
  <//>`;
}
