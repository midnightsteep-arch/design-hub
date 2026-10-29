// Page editor (markdown + live preview, toolbar, draft autosave, three-way merge on save — contract §8),
// merge dialog, page version history (versions = commits touching the page file), line diff.
import { html, cx, storage, relTime, fullTime, debounce } from '../lib.js';
import { useEffect, useMemo, useRef, useState } from '../../vendor/hooks.module.js';
import { Icon } from '../icons.js';
import { useStore } from '../store.js';
import * as G from '../github.js';
import { repoStore, savePage, reloadRepo } from '../repo.js';
import { joinChunks, withMarkers } from '../merge3.js';
import { parseCommitMessage } from '../commitmsg.js';
import { Modal, Drawer, Menu, confirmDialog } from './overlay.js';
import { MarkdownView } from './markdownview.js';
import { Btn, SkeletonLines, ErrorPanel, Segmented, Avatar, useElementWidth } from './ui.js';
import { toast } from './toast.js';
import { commitWho, commitTime, withIssueLinks } from '../pages/util.js';

// ---------------------------------------------------------------- line diff (LCS)
export function lineDiff(a, b) {
  const A = String(a || '').split('\n'), B = String(b || '').split('\n');
  const n = A.length, m = B.length;
  if (n * m > 4e6) return [{ t: 'del', s: '(too large to compare)' }];
  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) { out.push({ t: 'eq', s: A[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ t: 'del', s: A[i++] }); }
    else out.push({ t: 'add', s: B[j++] });
  }
  while (i < n) out.push({ t: 'del', s: A[i++] });
  while (j < m) out.push({ t: 'add', s: B[j++] });
  return out;
}

export function DiffView({ from, to, labels = ['theirs', 'yours'], context = 3 }) {
  const d = useMemo(() => lineDiff(from, to), [from, to]);
  const keep = new Set();
  d.forEach((x, i) => { if (x.t !== 'eq') for (let k = Math.max(0, i - context); k <= Math.min(d.length - 1, i + context); k++) keep.add(k); });
  const rows = [];
  let skipped = 0;
  d.forEach((x, i) => {
    if (!keep.has(i)) { skipped++; return; }
    if (skipped) { rows.push({ t: 'skip', s: `… ${skipped} unchanged line${skipped === 1 ? '' : 's'}` }); skipped = 0; }
    rows.push(x);
  });
  if (skipped) rows.push({ t: 'skip', s: `… ${skipped} unchanged line${skipped === 1 ? '' : 's'}` });
  const adds = d.filter((x) => x.t === 'add').length, dels = d.filter((x) => x.t === 'del').length;
  return html`<div class="diff">
    <div class="diff-head"><span class="diff-del-n">− ${dels} only in ${labels[0]}</span><span class="diff-add-n">+ ${adds} only in ${labels[1]}</span></div>
    <pre class="diff-body">${!adds && !dels ? html`<span class="diff-line diff-skip">No differences.</span>` : rows.map((r, i) => html`<span key=${i} class=${'diff-line diff-' + r.t}><span class="diff-sign" aria-hidden="true">${r.t === 'add' ? '+' : r.t === 'del' ? '−' : ' '}</span>${r.s || ' '}</span>`)}</pre>
  </div>`;
}

// ---------------------------------------------------------------- helpers
export const draftKey = (pageId) => { const s = repoStore.get(); return `hub.draft.${s.owner}/${s.repo}/${pageId}`; };
const MARKER_RE = /^(<{7} your version|={7}|>{7} their version)$/m;
const countMarkers = (t) => (String(t).match(/^<{7} your version$/gm) || []).length;

/** Who last changed a file (latest commit touching it), for "merged with X's edits". */
async function lastEditor(path, skipFirst) {
  const s = repoStore.get();
  try {
    const { commits } = await G.listCommits(s.owner, s.repo, { sha: s.branch, path, perPage: skipFirst ? 2 : 1 });
    const c = commits[skipFirst ? 1 : 0];
    return c ? commitWho(c, parseCommitMessage(c.commit.message)).name : null;
  } catch (e) { return null; }
}

function directiveItems() {
  const s = repoStore.get();
  const items = [];
  const roots = s.schema ? (s.schema.tables || []).filter((t) => !t.parent) : [];
  if (roots.length) {
    items.push({ heading: 'Tuning tables (editable)' });
    for (const t of roots) items.push({ key: 't:' + t.id, label: t.label || t.id, hint: `tuning:${t.id}`, icon: 'sliders', insert: `{{tuning:${t.id}}}` });
  }
  const views = Object.values(s.views || {}).filter((v) => v && v.id);
  if (views.length) {
    items.push({ heading: 'Data tables (read-only)' });
    for (const v of views) {
      items.push({ key: 'v:' + v.id, label: v.title || v.id, hint: `view:${v.id}`, icon: 'table', insert: `{{view:${v.id}}}` });
      const keys = (v.columns || []).map((c) => c.key);
      if (keys.includes('label') && keys.includes('value')) items.push({ key: 's:' + v.id, label: `${v.title || v.id} as stat cards`, hint: `stats:${v.id}`, icon: 'grid', insert: `{{stats:${v.id}}}` });
      for (const c of v.charts || []) items.push({ key: 'c:' + v.id + c.id, label: c.title || c.id, hint: `chart:${v.id}/${c.id}`, icon: 'chart', insert: `{{chart:${v.id}/${c.id}}}` });
    }
  }
  if ((s.groups || []).length) {
    items.push({ heading: 'Asset review' });
    for (const g of s.groups) items.push({ key: 'g:' + g.id, label: g.title || g.id, hint: `assets:${g.id}`, icon: 'image', insert: `{{assets:${g.id}}}` });
  }
  items.push({ separator: true });
  items.push({ key: 'toc', label: 'Table of contents', hint: 'toc', icon: 'list', insert: '{{toc}}' });
  return items;
}

// ---------------------------------------------------------------- editor
/**
 * props: page ({id,title,file}), path (repo path), base ({text, sha, missing} as loaded), onDone(), onSaved(result)
 */
export function PageEditor({ page, path, base: base0, onDone, onSaved }) {
  const [text, setText] = useState(base0.text || '');
  const [base, setBase] = useState({ text: base0.text || '', sha: base0.sha || null });
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [merge, setMerge] = useState(null); // {chunks, conflicts, theirs, who}
  const [handMerge, setHandMerge] = useState(false);
  const [view, setView] = useState('split');
  const [dirMenu, setDirMenu] = useState(false);
  const dirRef = useRef(null);
  const wrapRef = useRef(null);
  const width = useElementWidth(wrapRef);
  const narrow = width > 0 && width < 860;
  const key = draftKey(page.id);
  const [draft, setDraft] = useState(() => {
    const d = storage.get(key);
    return d && typeof d.text === 'string' && d.text !== (base0.text || '') ? d : null;
  });
  const taRef = useRef(null);
  const previewText = useDebouncedValue(text, 200);
  const dirty = text !== (base0.text || '') || base.sha !== (base0.sha || null);
  // draft autosave (hub.draft.<owner>/<repo>/<pageId>); typing back to the saved text drops the draft
  const saveDraft = useMemo(() => debounce((t, b, n) => {
    if (t === (base0.text || '')) storage.remove(key);
    else storage.set(key, { text: t, base: b, note: n, at: Date.now() });
  }, 400), [key]);
  const firstRun = useRef(true);
  useEffect(() => { if (firstRun.current) { firstRun.current = false; return; } saveDraft(text, base, note); }, [text, note]);
  useEffect(() => {
    const onBefore = (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', onBefore);
    return () => window.removeEventListener('beforeunload', onBefore);
  }, [dirty]);
  useEffect(() => { const el = taRef.current; if (el) { el.focus({ preventScroll: true }); el.setSelectionRange(0, 0); el.scrollTop = 0; } }, []);

  // ---- textarea helpers
  const edit = (fn) => {
    const el = taRef.current;
    if (!el) return;
    const s = el.selectionStart, e = el.selectionEnd, v = el.value;
    const r = fn(v, s, e);
    setText(r.value);
    requestAnimationFrame(() => { el.focus(); el.selectionStart = r.s; el.selectionEnd = r.e; });
  };
  const wrap = (pre, post, ph) => edit((v, s, e) => {
    const sel = v.slice(s, e) || ph;
    return { value: v.slice(0, s) + pre + sel + post + v.slice(e), s: s + pre.length, e: s + pre.length + sel.length };
  });
  const prefixLines = (prefix, re) => edit((v, s, e) => {
    const ls = v.lastIndexOf('\n', s - 1) + 1;
    let le = v.indexOf('\n', e); if (le < 0) le = v.length;
    const block = v.slice(ls, le).split('\n').map((l) => (re && re.test(l) ? l.replace(re, prefix) : prefix + l)).join('\n');
    return { value: v.slice(0, ls) + block + v.slice(le), s: ls, e: ls + block.length };
  });
  const insertBlock = (line) => edit((v, s) => {
    // directives go on their own line, with a blank line around them
    const ls = v.lastIndexOf('\n', s - 1) + 1;
    let le = v.indexOf('\n', s); if (le < 0) le = v.length;
    const lineEmpty = !v.slice(ls, le).trim();
    const before = v.slice(0, lineEmpty ? ls : le).replace(/\n+$/, '');
    const after = v.slice(le).replace(/^\n+/, '');
    const pre = before ? before + '\n\n' : '';
    const value = pre + line + (after ? '\n\n' + after : '\n');
    const caret = pre.length + line.length;
    return { value, s: caret, e: caret };
  });
  const link = () => edit((v, s, e) => {
    const sel = v.slice(s, e) || 'link text';
    const ins = `[${sel}](page:)`;
    return { value: v.slice(0, s) + ins + v.slice(e), s: s + ins.length - 1, e: s + ins.length - 1 };
  });

  // ---- save
  const doSave = async (b, t) => {
    if (busy) return;
    if (MARKER_RE.test(t) && !(await confirmDialog({ title: 'The text still has conflict markers', message: 'Lines like "<<<<<<< your version" are still in the page. Save anyway?', confirmLabel: 'Save anyway', cancelLabel: 'Keep editing' }))) return;
    setBusy(true);
    try {
      const res = await savePage(page.id, b, t, { note });
      if (res.status === 'conflict') {
        // move the app to the latest version, so saving the resolved text compares against what is there now
        try { await reloadRepo(); } catch (e) { /* offline: the save retries anyway */ }
        const who = await lastEditor(path, false);
        setMerge({ ...res.merge, theirs: res.theirs, who, mine: t });
      } else {
        storage.remove(key);
        if (res.status === 'nothing') toast('Nothing to save — the page is unchanged.');
        else if (res.merged) {
          const who = await lastEditor(path, true);
          toast(`Saved — merged with ${who ? who + "'s" : 'the latest'} edits`, { kind: 'success', detail: 'Someone saved this page while you were editing; your changes didn’t overlap, so both are kept.' });
        } else toast(`Saved “${page.title}”`, { kind: 'success' });
        onSaved && onSaved(res);
      }
    } catch (e) {
      toast("Couldn't save the page", { kind: 'error', detail: e.message });
    }
    setBusy(false);
  };
  const save = () => doSave(base, text);

  const onKey = (e) => {
    if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) { e.preventDefault(); if (dirty) save(); }
    if (e.target === taRef.current && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
      if (e.key === 'b' || e.key === 'B') { e.preventDefault(); wrap('**', '**', 'bold text'); }
      if (e.key === 'i' || e.key === 'I') { e.preventDefault(); wrap('_', '_', 'italic text'); }
    }
    if (e.key === 'Tab' && !e.shiftKey && e.target === taRef.current && !e.ctrlKey && e.target.dataset.tabTrap !== 'off') {
      // insert two spaces instead of leaving the editor (Esc then Tab moves focus on)
      e.preventDefault();
      edit((v, s, en) => ({ value: v.slice(0, s) + '  ' + v.slice(en), s: s + 2, e: s + 2 }));
    }
    if (e.key === 'Escape' && e.target === taRef.current) e.target.dataset.tabTrap = 'off';
  };
  const cancel = async () => {
    if (dirty && !(await confirmDialog({ title: 'Stop editing?', message: 'Your unsaved changes are kept as a draft in this browser, so you can restore them the next time you edit this page.', confirmLabel: 'Stop editing', cancelLabel: 'Keep editing', danger: true }))) return;
    onDone();
  };
  const effView = narrow && view === 'split' ? 'write' : view;
  const markers = handMerge ? countMarkers(text) : 0;

  return html`<div class="editor pg-editor" onKeyDown=${onKey} ref=${wrapRef}>
    <div class="editor-bar pg-editor-bar">
      <div class="pg-editor-title"><${Icon} name="edit" size=${15} /><span>Editing <b>${page.title}</b></span></div>
      <${Segmented} size="sm" label="Editor layout" value=${effView} onChange=${setView} options=${[
        { value: 'write', label: 'Write', icon: 'edit' },
        ...(narrow ? [] : [{ value: 'split', label: 'Side by side', icon: 'columns' }]),
        { value: 'preview', label: 'Preview', icon: 'eye' },
      ]} />
      <span class="spacer"></span>
      <span class="muted editor-status">${busy ? 'Saving…' : dirty ? 'Unsaved changes' : 'No changes yet'}</span>
      <${Btn} kind="ghost" size="sm" onClick=${cancel}>Cancel<//>
      <${Btn} kind="primary" size="sm" icon="check" onClick=${save} disabled=${!dirty || busy} loading=${busy} title="Save (Ctrl+S)">Save<//>
    </div>
    ${base0.missing && !draft && html`<div class="note note-info editor-note"><${Icon} name="info" size=${14} /><span>This page has no content yet. Write it here; saving creates <code>${path}</code>.</span></div>`}
    ${draft && html`<div class="note note-info editor-note"><${Icon} name="history" size=${14} />
      <span>You have an unsaved draft of this page from ${relTime(draft.at)}.</span>
      <button type="button" class="btn btn-xs btn-secondary" onClick=${() => { setText(draft.text); if (draft.base && 'text' in draft.base) setBase(draft.base); if (draft.note) setNote(draft.note); setDraft(null); }}>Restore draft</button>
      <button type="button" class="btn btn-xs btn-ghost" onClick=${() => { storage.remove(key); setDraft(null); }}>Discard it</button></div>`}
    ${handMerge && html`<div class="note note-warn editor-note"><${Icon} name="alert" size=${14} />
      <span>${markers ? html`Edit the ${markers} marked part${markers === 1 ? '' : 's'}: keep what you want between <code>${'<<<<<<< your version'}</code> and <code>${'>>>>>>> their version'}</code>, then delete the marker lines.` : 'All markers removed. Save when you are happy with the text.'}</span></div>`}
    <div class=${cx('editor-panes', 'view-' + effView)}>
      ${effView !== 'preview' && html`<div class="editor-pane editor-write">
        <div class="pg-toolbar" role="toolbar" aria-label="Formatting">
          <button type="button" class="icon-btn icon-btn-sm pg-tb-text" title="Bold (Ctrl+B)" aria-label="Bold" onClick=${() => wrap('**', '**', 'bold text')}><b>B</b></button>
          <button type="button" class="icon-btn icon-btn-sm pg-tb-text" title="Italic (Ctrl+I)" aria-label="Italic" onClick=${() => wrap('_', '_', 'italic text')}><i>I</i></button>
          <button type="button" class="icon-btn icon-btn-sm pg-tb-text" title="Heading" aria-label="Heading" onClick=${() => prefixLines('## ', /^#{1,6}\s+/)}>H</button>
          <span class="pg-tb-sep" aria-hidden="true"></span>
          <button type="button" class="icon-btn icon-btn-sm" title="Bulleted list" aria-label="Bulleted list" onClick=${() => prefixLines('- ', /^[-*]\s+/)}><${Icon} name="list" size=${15} /></button>
          <button type="button" class="icon-btn icon-btn-sm" title="Checklist" aria-label="Checklist" onClick=${() => prefixLines('- [ ] ', /^[-*]\s+(\[[ x]\]\s+)?/)}><${Icon} name="check" size=${15} /></button>
          <button type="button" class="icon-btn icon-btn-sm" title="Link" aria-label="Link" onClick=${link}><${Icon} name="link" size=${15} /></button>
          <span class="pg-tb-sep" aria-hidden="true"></span>
          <button type="button" class="btn btn-ghost btn-xs pg-tb-insert" ref=${dirRef} aria-haspopup="menu" aria-expanded=${String(dirMenu)} onClick=${() => setDirMenu(!dirMenu)}>
            <${Icon} name="plus" size=${13} /><span>Insert</span><${Icon} name="chevron-down" size=${12} /></button>
          ${dirMenu && html`<${Menu} anchor=${dirRef} onClose=${() => setDirMenu(false)} label="Insert a table, chart or asset group" class="pg-dir-menu"
            items=${directiveItems().map((it) => (it.insert ? { ...it, onSelect: () => insertBlock(it.insert) } : it))} />`}
        </div>
        <textarea ref=${taRef} class="editor-textarea mono" value=${text} spellcheck="true" aria-label="Page text (markdown)"
          onInput=${(e) => { setText(e.currentTarget.value); e.currentTarget.dataset.tabTrap = 'on'; }}></textarea>
        <div class="editor-help muted">Markdown · <b>Insert</b> adds live tables and charts · <code>[text](page:ID)</code> links a page · Ctrl+S saves · Esc then Tab leaves the editor</div>
      </div>`}
      ${effView !== 'write' && html`<div class="editor-pane editor-preview" aria-label="Preview"><${MarkdownView} body=${previewText} pagePath=${path} /></div>`}
    </div>
    <div class="pg-editor-foot">
      <label class="field pg-note-field"><span class="label-sm">What did you change? <span class="muted">(optional — shown in History)</span></span>
        <input class="input" value=${note} maxLength=${200} onInput=${(e) => setNote(e.currentTarget.value)} placeholder="e.g. Added the boss phase-2 notes" /></label>
      <${Btn} kind="primary" icon="check" onClick=${save} disabled=${!dirty || busy} loading=${busy}>Save<//>
    </div>
    ${merge && html`<${MergeDialog} merge=${merge} busy=${busy}
      onCancel=${() => setMerge(null)}
      onByHand=${() => { setText(withMarkers(merge.chunks)); setBase(merge.theirs); setHandMerge(true); setMerge(null); }}
      onResolve=${(resolved) => { const th = merge.theirs; setText(resolved); setBase(th); setMerge(null); doSave(th, resolved); }} />`}
  </div>`;
}

function useDebouncedValue(v, ms) {
  const [x, setX] = useState(v);
  useEffect(() => { const t = setTimeout(() => setX(v), ms); return () => clearTimeout(t); }, [v, ms]);
  return x;
}

// ---------------------------------------------------------------- merge dialog
function Lines({ lines, empty }) {
  if (!lines.length) return html`<div class="pg-mg-empty muted">${empty}</div>`;
  return html`<pre class="pg-mg-lines">${lines.join('\n')}</pre>`;
}

/** Per-conflict choice: Use mine / Use theirs / Use both. Non-conflicting parts are already merged. */
export function MergeDialog({ merge, onCancel, onResolve, onByHand, busy }) {
  const conflicts = merge.chunks.filter((c) => c.type === 'conflict');
  const [picks, setPicks] = useState(() => conflicts.map(() => null));
  const done = picks.every(Boolean);
  const pick = (i, v) => setPicks((p) => p.map((x, k) => (k === i ? v : x)));
  // a couple of unchanged lines around each conflict, for orientation
  const ctxOf = (ci) => {
    let k = -1, idx = -1;
    merge.chunks.forEach((c, j) => { if (c.type === 'conflict') { k++; if (k === ci) idx = j; } });
    const prev = merge.chunks[idx - 1], next = merge.chunks[idx + 1];
    return { before: prev && prev.type === 'ok' ? prev.lines.slice(-2) : [], after: next && next.type === 'ok' ? next.lines.slice(0, 2) : [] };
  };
  const resolve = () => onResolve(joinChunks(merge.chunks, (c, i) => (picks[i] === 'mine' ? c.mine : picks[i] === 'theirs' ? c.theirs : [...c.mine, ...c.theirs])));
  const who = merge.who || 'Someone';
  return html`<${Modal} title=${`${who} changed the same lines`} onClose=${onCancel} size="lg" class="pg-merge" closeOnScrim=${false}
    footer=${html`<div class="conflict-actions pg-merge-actions">
      <${Btn} kind="ghost" icon="edit" onClick=${onByHand}>Edit by hand<//>
      <span class="spacer"></span>
      <${Btn} kind="ghost" onClick=${onCancel}>Back to editing<//>
      <${Btn} kind="primary" icon="check" disabled=${!done || busy} loading=${busy} onClick=${resolve}>Save combined version<//>
    </div>`}>
    <p class="pg-merge-intro">${who} saved this page while you were editing. Everything that doesn't overlap is already combined.
      For ${conflicts.length === 1 ? 'the part' : `each of the ${conflicts.length} parts`} you both changed, choose what to keep.</p>
    <ol class="pg-mg-list">
      ${conflicts.map((c, i) => {
        const cx0 = ctxOf(i);
        return html`<li class="pg-mg" key=${i}>
          <div class="pg-mg-head"><b>Part ${i + 1} of ${conflicts.length}</b>
            <span class="spacer"></span>
            <${Segmented} size="sm" label=${`Choice for part ${i + 1}`} value=${picks[i]} onChange=${(v) => pick(i, v)} options=${[
              { value: 'mine', label: 'Use mine' }, { value: 'theirs', label: 'Use theirs' }, { value: 'both', label: 'Use both' },
            ]} />
          </div>
          ${cx0.before.length > 0 && html`<pre class="pg-mg-ctx">${cx0.before.join('\n')}</pre>`}
          <div class="pg-mg-cols">
            <div class=${cx('pg-mg-col', 'is-mine', (picks[i] === 'mine' || picks[i] === 'both') && 'is-picked', (picks[i] === 'theirs') && 'is-dropped')}>
              <div class="pg-mg-label">Your version</div><${Lines} lines=${c.mine} empty="(you removed these lines)" /></div>
            <div class=${cx('pg-mg-col', 'is-theirs', (picks[i] === 'theirs' || picks[i] === 'both') && 'is-picked', (picks[i] === 'mine') && 'is-dropped')}>
              <div class="pg-mg-label">Their version</div><${Lines} lines=${c.theirs} empty="(they removed these lines)" /></div>
          </div>
          ${cx0.after.length > 0 && html`<pre class="pg-mg-ctx">${cx0.after.join('\n')}</pre>`}
        </li>`;
      })}
    </ol>
  <//>`;
}

// ---------------------------------------------------------------- history drawer
/**
 * Versions of a page = commits touching its file. props: page, path, current ({text, sha}), canPush, onClose, onRestored.
 */
export function PageHistoryDrawer({ page, path, current, canPush, onClose, onRestored }) {
  const head = useStore(repoStore, (s) => s.head);
  const [list, setList] = useState(null);
  const [more, setMore] = useState(false);
  const [pageN, setPageN] = useState(1);
  const [error, setError] = useState(null);
  const [sel, setSel] = useState(null); // commit
  const [rev, setRev] = useState(null); // {text|null}
  const [mode, setMode] = useState('rendered');
  const [busy, setBusy] = useState(false);
  const load = (n = 1) => {
    const s = repoStore.get();
    G.listCommits(s.owner, s.repo, { sha: s.branch, path, perPage: 30, page: n })
      .then((r) => { setList((l) => (n === 1 ? r.commits : [...(l || []), ...r.commits])); setMore(r.hasMore); setPageN(n); setError(null); })
      .catch(setError);
  };
  useEffect(() => { load(1); }, [path, head]);
  useEffect(() => {
    if (!sel) { setRev(null); return undefined; }
    setRev(null);
    let alive = true;
    const s = repoStore.get();
    G.readFile(s.owner, s.repo, path, sel.sha)
      .then((r) => { if (alive) setRev({ text: r ? G.bytesToText(r.bytes) : null }); })
      .catch((e) => { if (alive) { toast("Couldn't load that version", { kind: 'error', detail: e.message }); setSel(null); } });
    return () => { alive = false; };
  }, [sel]);
  const isCurrent = sel && list && list[0] && list[0].sha === sel.sha;
  const restore = async () => {
    if (!rev || rev.text == null || busy) return;
    const when = fullTime(commitTime(sel));
    if (!(await confirmDialog({ title: 'Restore this version?', message: `The page goes back to how it was on ${when}. This is saved as a new change, so today's text stays in the history too.`, confirmLabel: 'Restore' }))) return;
    setBusy(true);
    try {
      const res = await savePage(page.id, { text: current.text, sha: current.sha }, rev.text, { note: `Restored the version from ${when}` });
      if (res.status === 'conflict') toast('The page changed meanwhile — close History, then try again.', { kind: 'error' });
      else { toast(res.status === 'nothing' ? 'That version is the same as the current page.' : `Restored the version from ${when}`, { kind: 'success' }); onRestored && onRestored(res); }
    } catch (e) { toast("Couldn't restore", { kind: 'error', detail: e.message }); }
    setBusy(false);
  };
  const title = sel ? `Version from ${fullTime(commitTime(sel))}` : `History · ${page.title}`;
  return html`<${Drawer} title=${title} onClose=${onClose} width=${sel ? 780 : 440} class="pg-hist-drawer"
    headerExtra=${sel && html`<button type="button" class="btn btn-ghost btn-sm" onClick=${() => setSel(null)}><${Icon} name="arrow-left" size=${14} /><span class="btn-label">All versions</span></button>`}>
    ${error && !list ? html`<${ErrorPanel} error=${error} compact onRetry=${() => load(1)} />`
      : !list ? html`<${SkeletonLines} lines=${6} />`
      : !sel ? html`<ol class="rev-list pg-rev-list">
          ${list.map((c, i) => {
            const m = parseCommitMessage(c.commit.message);
            const who = commitWho(c, m);
            const at = commitTime(c);
            return html`<li key=${c.sha}><button type="button" class="rev-item" onClick=${() => setSel(c)}>
              <${Avatar} actor=${who.actor} size=${24} />
              <span class="rev-main"><span class="pg-rev-sum">${m.summary || 'Change'}</span>
                <span class="muted">${who.name}${who.engine ? ' · ' + who.engine : ''} · <time title=${fullTime(at)}>${relTime(at)}</time></span>
                ${m.note && html`<span class="pg-rev-note">${withIssueLinks(m.note)}</span>`}</span>
              ${i === 0 ? html`<span class="badge badge-accent">Current</span>` : html`<${Icon} name="chevron-right" size=${14} class="muted" />`}
            </button></li>`;
          })}
          ${!list.length && html`<li class="muted">No saved versions yet.</li>`}
          ${more && html`<li class="pg-rev-more"><${Btn} size="sm" onClick=${() => load(pageN + 1)}>Show older versions<//></li>`}
        </ol>`
      : !rev ? html`<${SkeletonLines} lines=${8} />`
      : html`<div class="rev-view">
          <div class="rev-view-bar">
            <${Segmented} size="sm" label="Show" value=${mode} onChange=${setMode} options=${[{ value: 'rendered', label: 'Page' }, { value: 'diff', label: 'Changes vs now' }, { value: 'source', label: 'Text' }]} />
            <span class="spacer"></span>
            ${sel.html_url && html`<a class="btn btn-ghost btn-sm" href=${sel.html_url} target="_blank" rel="noopener noreferrer"><${Icon} name="github" size=${14} /><span class="btn-label">View on GitHub</span></a>`}
            ${canPush && !isCurrent && rev.text != null && html`<${Btn} kind="primary" size="sm" icon="undo" onClick=${restore} loading=${busy}>Restore this version<//>`}
          </div>
          ${rev.text == null ? html`<p class="muted">The page had no content in this version.</p>`
            : mode === 'rendered' ? html`<div class="rev-rendered"><${MarkdownView} body=${rev.text} pagePath=${path} /></div>`
            : mode === 'diff' ? html`<${DiffView} from=${current.text} to=${rev.text} labels=${['now', 'this version']} />`
            : html`<pre class="rev-source mono">${rev.text}</pre>`}
        </div>`}
  <//>`;
}
