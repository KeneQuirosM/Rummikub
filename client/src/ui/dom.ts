import { applyI18n } from '../i18n';

export function $<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} no existe`);
  return el as T;
}

export function show(el: HTMLElement, on = true) {
  el.hidden = !on;
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export function toast(msg: string, kind: 'info' | 'error' | 'ok' = 'info', ms = 2600) {
  const root = $('toasts');
  // evitar duplicados seguidos
  const last = root.lastElementChild as HTMLElement | null;
  if (last && last.textContent === msg) last.remove();
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = msg;
  root.appendChild(el);
  while (root.children.length > 3) root.firstElementChild?.remove();
  setTimeout(() => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 300);
  }, ms);
}

export function banner(msg: string | null, kind: 'error' | 'warn' = 'error') {
  const el = $('banner');
  if (!msg) {
    el.hidden = true;
    return;
  }
  el.textContent = msg;
  el.className = `banner ${kind === 'warn' ? 'warn' : ''}`;
  el.hidden = false;
}

export interface Modal {
  el: HTMLElement;
  close(): void;
}

let openModals: Modal[] = [];

/** Abre un modal con HTML; los elementos con data-close lo cierran. */
export function modal(html: string, opts: { dismissible?: boolean; onClose?: () => void; className?: string } = {}): Modal {
  const root = $('modal-root');
  const back = document.createElement('div');
  back.className = 'modal-backdrop';
  back.innerHTML = `<div class="card modal ${opts.className ?? ''}" role="dialog" aria-modal="true">${html}</div>`;
  applyI18n(back);
  root.appendChild(back);
  let closed = false;
  const m: Modal = {
    el: back.firstElementChild as HTMLElement,
    close() {
      if (closed) return;
      closed = true;
      back.remove();
      openModals = openModals.filter((x) => x !== m);
      opts.onClose?.();
    },
  };
  back.addEventListener('click', (e) => {
    if (e.target === back && opts.dismissible !== false) m.close();
    const t = (e.target as HTMLElement).closest('[data-close]');
    if (t) m.close();
  });
  openModals.push(m);
  return m;
}

export function closeAllModals() {
  [...openModals].forEach((m) => m.close());
}

export function hasOpenModal(): boolean {
  return openModals.length > 0;
}

export function confirmDialog(text: string, okLabel: string, cancelLabel: string): Promise<boolean> {
  return new Promise((resolve) => {
    let result = false;
    const m = modal(
      `<h2>${escapeHtml(text)}</h2><div class="actions-row"><button class="btn" data-close>${escapeHtml(cancelLabel)}</button><button class="btn btn-gold" id="cf-ok">${escapeHtml(okLabel)}</button></div>`,
      { onClose: () => resolve(result) },
    );
    m.el.querySelector('#cf-ok')!.addEventListener('click', () => {
      result = true;
      m.close();
    });
  });
}
