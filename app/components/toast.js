// Toasts with optional action (Undo). Rendered into #toasts (aria-live region).
import { html, render } from '../lib.js';
import { createStore, useStore } from '../store.js';
import { Icon } from '../icons.js';
import { useEffect, useRef, useState } from '../../vendor/hooks.module.js';

const toasts = createStore({ list: [] });
let seq = 1;

export function toast(message, opts = {}) {
  const id = seq++;
  const t = { id, message, kind: opts.kind || 'info', action: opts.action || null, duration: opts.duration ?? (opts.action ? 7000 : opts.kind === 'error' ? 7000 : 3500), detail: opts.detail };
  toasts.set((s) => ({ list: [...s.list.slice(-3), t] }));
  return id;
}
export function dismissToast(id) {
  toasts.set((s) => ({ list: s.list.filter((t) => t.id !== id) }));
}
export const toastError = (e, prefix) => toast((prefix ? prefix + ': ' : '') + ((e && e.message) || String(e)), { kind: 'error' });

function ToastItem({ t }) {
  const [hover, setHover] = useState(false);
  const timer = useRef(null);
  useEffect(() => {
    if (hover || !t.duration) return undefined;
    timer.current = setTimeout(() => dismissToast(t.id), t.duration);
    return () => clearTimeout(timer.current);
  }, [hover, t.id]);
  const icon = t.kind === 'error' ? 'alert' : t.kind === 'success' ? 'check' : 'info';
  return html`
    <div class=${'toast toast-' + t.kind} role=${t.kind === 'error' ? 'alert' : 'status'}
      onMouseEnter=${() => setHover(true)} onMouseLeave=${() => setHover(false)}
      onFocusIn=${() => setHover(true)} onFocusOut=${() => setHover(false)}>
      <span class="toast-icon"><${Icon} name=${icon} size=${16} /></span>
      <div class="toast-body">
        <div class="toast-msg">${t.message}</div>
        ${t.detail && html`<div class="toast-detail">${t.detail}</div>`}
      </div>
      ${t.action && html`<button class="btn btn-sm btn-ghost toast-action" onClick=${() => { dismissToast(t.id); t.action.run(); }}>
        ${t.action.icon && html`<${Icon} name=${t.action.icon} size=${14} />`}${t.action.label}</button>`}
      <button class="icon-btn icon-btn-sm toast-close" aria-label="Dismiss" onClick=${() => dismissToast(t.id)}><${Icon} name="x" size=${14} /></button>
    </div>`;
}

function Toasts() {
  const list = useStore(toasts, (s) => s.list);
  return html`<div class="toast-stack">${list.map((t) => html`<${ToastItem} key=${t.id} t=${t} />`)}</div>`;
}

export function mountToasts() {
  const el = document.getElementById('toasts');
  if (el) render(html`<${Toasts} />`, el);
}
