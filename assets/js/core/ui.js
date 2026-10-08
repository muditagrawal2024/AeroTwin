// Shared UI helpers: brand mark, top bar, toasts, modals and confirmations.
import { h } from './util.js';

export const brandMark = () => {
  const wrap = document.createElement('span');
  wrap.innerHTML = `<svg class="brand-mark" viewBox="0 0 32 32" aria-hidden="true">
    <g stroke="#ff7a1a" stroke-width="2.6" stroke-linecap="round"><line x1="9" y1="9" x2="23" y2="23"/><line x1="23" y1="9" x2="9" y2="23"/></g>
    <g fill="none" stroke="#9fc3dc" stroke-width="1.6"><circle cx="8" cy="8" r="5"/><circle cx="24" cy="8" r="5"/><circle cx="8" cy="24" r="5"/><circle cx="24" cy="24" r="5"/></g>
    <rect x="12.5" y="12.5" width="7" height="7" rx="2" fill="#e7eef5"/></svg>`;
  return wrap.firstElementChild;
};

export const icons = {
  bucket: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3Z"/><path d="M4 6l1.8 13c.2 1.2 2.9 2 6.2 2s6-.8 6.2-2L20 6"/></svg>',
  drone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="5" cy="5" r="3"/><circle cx="19" cy="5" r="3"/><circle cx="5" cy="19" r="3"/><circle cx="19" cy="19" r="3"/><path d="M7 7l3.5 3.5M17 7l-3.5 3.5M7 17l3.5-3.5M17 17l-3.5-3.5"/><rect x="9.5" y="9.5" width="5" height="5" rx="1"/></svg>',
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/></svg>',
  bill: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6M9 16h3"/></svg>',
  term: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9l3 3-3 3M12 15h5"/></svg>',
  list: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M8 6h13M8 12h13M8 18h13"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/></svg>',
  info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/></svg>',
  folder: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
  file: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/></svg>',
  upload: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 16V4M7 9l5-5 5 5M4 20h16"/></svg>',
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6L6 18"/></svg>'
};
export const icon = name => {
  const s = document.createElement('span');
  s.className = 'ic';
  s.innerHTML = icons[name] || '';
  return s;
};

// ---------- toasts ----------
let toastRoot;
export function toast(title, body = '', kind = 'ok', ms = 4200) {
  if (!toastRoot) { toastRoot = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' }); document.body.append(toastRoot); }
  const t = h('div', { class: `toast ${kind}` }, h('div', { class: 't-title' }, title), body ? h('div', { class: 't-body' }, body) : null);
  toastRoot.append(t);
  while (toastRoot.children.length > 5) toastRoot.firstElementChild.remove();
  setTimeout(() => t.remove(), ms);
}
export function toastError(e) {
  toast(e.code || 'Error', e.message || String(e), 'error', 6500);
}

// ---------- modals ----------
export function modal({ title, body, actions = [], wide = false, onClose }) {
  const close = () => { back.remove(); document.removeEventListener('keydown', onKey); onClose?.(); };
  const onKey = e => { if (e.key === 'Escape') close(); };
  const footer = actions.length ? h('footer', {}, ...actions.map(a => h('button', {
    class: `btn ${a.kind || ''}`, type: 'button',
    onclick: async ev => {
      if (!a.onClick) return close();
      const btn = ev.currentTarget;
      btn.disabled = true;
      try { const r = await a.onClick(close); if (r !== false) close(); }
      catch (e) { toastError(e); }
      finally { btn.disabled = false; }
    }
  }, a.label))) : null;
  const m = h('div', { class: `modal ${wide ? 'wide' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('header', {}, h('h2', {}, title), h('button', { class: 'btn ghost small', 'aria-label': 'Close', onclick: close, html: icons.close })),
    h('div', { class: 'body' }, body),
    footer);
  const back = h('div', { class: 'modal-backdrop', onclick: e => { if (e.target === back) close(); } }, m);
  document.body.append(back);
  document.addEventListener('keydown', onKey);
  setTimeout(() => m.querySelector('input, textarea, select, button.primary')?.focus(), 30);
  return { close, el: m };
}

export function confirmDialog({ title, message, confirmLabel = 'Confirm', danger = false, typeToConfirm }) {
  return new Promise(resolve => {
    let input;
    const body = h('div', { class: 'stack' },
      h('p', {}, message),
      typeToConfirm ? h('label', { class: 'field' }, h('span', {}, `Type ${typeToConfirm} to confirm`), input = h('input', { type: 'text', autocomplete: 'off' })) : null);
    modal({
      title, body,
      onClose: () => resolve(false),
      actions: [
        { label: 'Cancel', onClick: () => { resolve(false); } },
        { label: confirmLabel, kind: danger ? 'danger' : 'primary', onClick: () => {
          if (typeToConfirm && input.value !== typeToConfirm) { input.focus(); input.style.borderColor = 'var(--red)'; return false; }
          resolve(true);
        } }
      ]
    });
  });
}

// ---------- top bar ----------
export function topbar({ active } = {}) {
  const link = (href, id, label) => h('a', { href, class: active === id ? 'on' : '', 'aria-current': active === id ? 'page' : null }, label);
  return h('header', { class: 'topbar' },
    h('a', { class: 'brand', href: 'index.html', 'aria-label': 'AeroTwin home' }, brandMark(), h('span', { class: 'brand-word' }, 'AeroTwin')),
    h('nav', { class: 'top-links', 'aria-label': 'Primary' },
      link('sim.html', 'sim', 'Fly'),
      link('logbook.html', 'logbook', 'Logbook'),
      link('index.html#controls', 'controls', 'Controls')),
    h('span', { class: 'spacer' }),
    active !== 'sim' ? h('a', { class: 'btn primary small', href: 'sim.html' }, 'Launch simulator') : null
  );
}
