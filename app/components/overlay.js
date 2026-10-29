// Overlays: Portal, focus trap + Esc stack, Modal, Drawer, Popover, Menu.
import { html, render, cx } from '../lib.js';
import { useEffect, useLayoutEffect, useRef, useState, useCallback } from '../../vendor/hooks.module.js';
import { Icon } from '../icons.js';

export function Portal({ children }) {
  const el = useRef(null);
  if (!el.current && typeof document !== 'undefined') {
    el.current = document.createElement('div');
    el.current.className = 'portal-root';
  }
  useLayoutEffect(() => {
    document.body.appendChild(el.current);
    return () => { render(null, el.current); el.current.remove(); };
  }, []);
  useLayoutEffect(() => { render(children, el.current); });
  return null;
}

// ---------------------------------------------------------------- overlay stack
const stack = [];
export function overlayOpen() { return stack.length > 0; }
export function topOverlay() { return stack[stack.length - 1]; }

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"]),[contenteditable="true"]';
export function focusables(root) {
  return Array.from(root.querySelectorAll(FOCUSABLE)).filter((el) => el.offsetParent !== null || el === document.activeElement);
}

// Bubble phase: a field that handles Esc itself (revert a draft, cancel an edit) stops it first.
// In a multi-line field without its own handler, the first Esc only leaves the field.
document.addEventListener('keydown', (e) => {
  const top = stack[stack.length - 1];
  if (!top) return;
  if (e.key === 'Escape' && top.onEscape) {
    if (e.defaultPrevented) return;
    const t = e.target;
    if (t && t.tagName === 'TEXTAREA' && top.ref.current && top.ref.current.contains(t)) {
      e.preventDefault();
      t.blur();
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    top.onEscape(e);
    return;
  }
  if (e.key === 'Tab' && top.trap && top.ref.current && !e.defaultPrevented) {
    const els = focusables(top.ref.current);
    if (!els.length) { e.preventDefault(); top.ref.current.focus(); return; }
    const first = els[0], last = els[els.length - 1];
    const a = document.activeElement;
    if (!top.ref.current.contains(a)) { e.preventDefault(); first.focus(); return; }
    if (a === top.ref.current) { e.preventDefault(); (e.shiftKey ? last : first).focus(); return; }
    if (e.shiftKey && a === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && a === last) { e.preventDefault(); first.focus(); }
  }
});

// Register an overlay layer: Esc closes it, Tab is trapped (when trap), focus restored on close.
export function useLayer(ref, { onEscape, trap = true, autoFocus = true, restoreFocus = true } = {}) {
  const entry = useRef(null);
  if (!entry.current) entry.current = { ref, trap, onEscape };
  entry.current.onEscape = onEscape;
  useLayoutEffect(() => {
    const prev = document.activeElement;
    stack.push(entry.current);
    if (autoFocus && ref.current) {
      const target = ref.current.querySelector('[data-autofocus]') || ref.current;
      requestAnimationFrame(() => { try { target.focus({ preventScroll: true }); } catch (x) { /* ignore */ } });
    }
    return () => {
      const i = stack.indexOf(entry.current);
      if (i >= 0) stack.splice(i, 1);
      if (restoreFocus && prev && prev.focus && document.contains(prev)) {
        try { prev.focus({ preventScroll: true }); } catch (x) { /* ignore */ }
      }
    };
  }, []);
}

export function useBodyLock() {
  useLayoutEffect(() => {
    const root = document.documentElement;
    const n = Number(root.dataset.lock || 0) + 1;
    root.dataset.lock = String(n);
    root.classList.add("scroll-locked");
    return () => {
      const m = Number(root.dataset.lock || 1) - 1;
      root.dataset.lock = String(m);
      if (m <= 0) root.classList.remove("scroll-locked");
    };
  }, []);
}

// ---------------------------------------------------------------- Modal
export function Modal({ title, onClose, children, footer, size = 'md', labelledBy, class: cls, closeOnScrim = true, hideHeader }) {
  const ref = useRef(null);
  useLayer(ref, { onEscape: onClose });
  useBodyLock();
  const id = useRef('dlg-' + Math.random().toString(36).slice(2, 8)).current;
  return html`<${Portal}>
    <div class="scrim" onMouseDown=${(e) => { if (closeOnScrim && e.target === e.currentTarget) onClose && onClose(); }}>
      <div class=${cx('modal', 'modal-' + size, cls)} role="dialog" aria-modal="true" aria-labelledby=${labelledBy || (title ? id : undefined)} ref=${ref} tabindex="-1">
        ${!hideHeader && html`<div class="modal-head">
          <h2 class="modal-title" id=${id}>${title}</h2>
          <button class="icon-btn" aria-label="Close" onClick=${onClose}><${Icon} name="x" size=${16} /></button>
        </div>`}
        <div class="modal-body">${children}</div>
        ${footer && html`<div class="modal-foot">${footer}</div>`}
      </div>
    </div>
  <//>`;
}

// ---------------------------------------------------------------- Drawer (side sheet)
export function Drawer({ title, onClose, children, side = 'right', width = 420, class: cls, headerExtra }) {
  const ref = useRef(null);
  useLayer(ref, { onEscape: onClose });
  useBodyLock();
  const id = useRef('drw-' + Math.random().toString(36).slice(2, 8)).current;
  return html`<${Portal}>
    <div class="scrim scrim-drawer" onMouseDown=${(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <aside class=${cx('drawer', 'drawer-' + side, cls)} style=${{ '--drawer-w': width + 'px' }} role="dialog" aria-modal="true" aria-labelledby=${id} ref=${ref} tabindex="-1">
        <div class="drawer-head">
          <h2 class="drawer-title" id=${id}>${title}</h2>
          ${headerExtra}
          <button class="icon-btn" aria-label="Close" onClick=${onClose}><${Icon} name="x" size=${16} /></button>
        </div>
        <div class="drawer-body">${children}</div>
      </aside>
    </div>
  <//>`;
}

// ---------------------------------------------------------------- Popover (anchored, fixed position)
export function Popover({ anchor, onClose, children, placement = 'bottom-start', class: cls, trap = false, role = 'dialog', label, width, offset = 6 }) {
  const ref = useRef(null);
  const [pos, setPos] = useState(null);
  useLayer(ref, { onEscape: onClose, trap, autoFocus: true });
  const place = useCallback(() => {
    const a = anchor && (anchor.current || anchor);
    const el = ref.current;
    if (!a || !el || !a.getBoundingClientRect) return;
    const r = a.getBoundingClientRect();
    const w = el.offsetWidth, hgt = el.offsetHeight;
    const vw = window.innerWidth, vh = window.innerHeight;
    let top = placement.startsWith('top') ? r.top - hgt - offset : r.bottom + offset;
    if (!placement.startsWith('top') && top + hgt > vh - 8 && r.top - hgt - offset > 8) top = r.top - hgt - offset;
    if (placement.startsWith('top') && top < 8) top = r.bottom + offset;
    let left = placement.endsWith('end') ? r.right - w : r.left;
    left = Math.max(8, Math.min(left, vw - w - 8));
    top = Math.max(8, Math.min(top, vh - hgt - 8));
    setPos({ top, left });
  }, [anchor, placement, offset]);
  useLayoutEffect(() => {
    place();
    const onDown = (e) => {
      const a = anchor && (anchor.current || anchor);
      if (ref.current && !ref.current.contains(e.target) && !(a && a.contains && a.contains(e.target))) onClose();
    };
    const onScroll = (e) => { if (ref.current && ref.current.contains(e.target)) return; place(); };
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('touchstart', onDown, true);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('touchstart', onDown, true);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [place]);
  return html`<${Portal}>
    <div class=${cx('popover', cls)} ref=${ref} role=${role} aria-label=${label} tabindex="-1"
      style=${{ top: (pos ? pos.top : -9999) + 'px', left: (pos ? pos.left : -9999) + 'px', width: width ? width + 'px' : undefined }}>
      ${children}
    </div>
  <//>`;
}

// ---------------------------------------------------------------- Menu (role=menu, arrow keys)
export function Menu({ anchor, onClose, items, label, placement, class: cls }) {
  const listRef = useRef(null);
  const real = items.filter((it) => it && !it.separator && !it.heading);
  const focusKey = (real.find((it) => it.checked && !it.disabled) || real.find((it) => !it.disabled) || {});
  const onKey = (e) => {
    const els = Array.from(listRef.current.querySelectorAll('[role="menuitem"]:not([disabled]),[role="menuitemradio"]:not([disabled])'));
    const i = els.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); els[(i + 1) % els.length]?.focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); els[(i - 1 + els.length) % els.length]?.focus(); }
    else if (e.key === 'Home') { e.preventDefault(); els[0]?.focus(); }
    else if (e.key === 'End') { e.preventDefault(); els[els.length - 1]?.focus(); }
    else if (e.key === 'Tab') { onClose(); }
  };
  return html`<${Popover} anchor=${anchor} onClose=${onClose} placement=${placement} class=${cx('menu', cls)} role="presentation">
    <div role="menu" aria-label=${label} ref=${listRef} onKeyDown=${onKey}>
      ${items.filter(Boolean).map((it, i) => it.separator
        ? html`<div class="menu-sep" role="separator" key=${'s' + i}></div>`
        : it.heading ? html`<div class="menu-heading" key=${'h' + i}>${it.heading}</div>`
        : html`<button key=${it.key || i} class=${cx('menu-item', it.danger && 'danger', it.checked && 'checked')}
            role=${it.checked != null ? 'menuitemradio' : 'menuitem'} aria-checked=${it.checked != null ? String(!!it.checked) : undefined}
            disabled=${it.disabled} data-autofocus=${it === focusKey || undefined}
            onClick=${() => { onClose(); it.onSelect && it.onSelect(); }}>
            ${it.icon ? html`<${Icon} name=${it.icon} size=${16} class=${it.iconClass} />` : html`<span class="menu-icon-gap"></span>`}
            <span class="menu-label">${it.label}</span>
            ${it.hint && html`<span class="menu-hint">${it.hint}</span>`}
            ${it.checked && html`<${Icon} name="check" size=${14} class="menu-check" />`}
          </button>`)}
    </div>
  <//>`;
}

// ---------------------------------------------------------------- confirm dialog (Promise<boolean>)
function ConfirmModal({ title, message, confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger, onDone }) {
  return html`<${Modal} title=${title} onClose=${() => onDone(false)} size="sm"
    footer=${html`<button type="button" class="btn btn-ghost" onClick=${() => onDone(false)}>${cancelLabel}</button>
      <button type="button" class=${cx('btn', danger ? 'btn-danger' : 'btn-primary')} data-autofocus onClick=${() => onDone(true)}>${confirmLabel}</button>`}>
    <p class="confirm-text">${message}</p>
  <//>`;
}
export function confirmDialog(opts) {
  return new Promise((resolve) => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const done = (v) => { render(null, el); el.remove(); resolve(v); };
    render(html`<${ConfirmModal} ...${opts} onDone=${done} />`, el);
  });
}
