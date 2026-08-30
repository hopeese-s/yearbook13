import { el, clear } from './dom.js';

/**
 * MacWindow: draggable macOS-style window chrome (Phase 6 Preview shell).
 * Reusable: open/close cycles are safe, Escape only works while open,
 * and the root survives close (re-attached on the next open).
 */
export function createMacWindow({ title, onClose } = {}) {
  const root = el('div', { class: 'mac-window', role: 'dialog', 'aria-modal': 'true', 'aria-label': title ?? 'Preview' });

  const titleNode = el('div', { class: 'window-title', text: title ?? '' });
  const titlebar = el(
    'div',
    { class: 'titlebar' },
    el(
      'div',
      { class: 'traffic-lights' },
      el('button', { class: 'tl-close', type: 'button', 'aria-label': 'Close', onclick: () => close() }),
      el('button', { class: 'tl-min', type: 'button', 'aria-label': 'Close window', onclick: () => close() }),
      el('button', { class: 'tl-zoom', type: 'button', 'aria-label': 'Zoom', onclick: () => toggleZoom() }),
    ),
    titleNode,
  );

  const body = el('div', { class: 'window-body' });
  root.append(titlebar, body);

  let isOpen = false;
  let previouslyFocused = null;
  let zoomed = false;
  let keydownBound = false;

  function toggleZoom() {
    if (!isOpen) return;
    zoomed = !zoomed;
    root.style.width = zoomed ? 'calc(100vw - 24px)' : '';
    root.style.height = zoomed ? 'calc(100vh - 24px)' : '';
  }

  function onKeydown(event) {
    if (event.key === 'Escape' && isOpen) close();
  }

  function ensureAttached() {
    if (!root.isConnected) {
      document.body.append(root);
      zoomed = false;
      root.style.width = '';
      root.style.height = '';
      root.style.left = '';
      root.style.top = '';
      root.style.transform = '';
    }
    if (!keydownBound) {
      document.addEventListener('keydown', onKeydown);
      keydownBound = true;
    }
  }

  function open() {
    if (isOpen) return;
    ensureAttached();
    isOpen = true;
    previouslyFocused = document.activeElement;
    // Double rAF so the transition runs after the node is attached/visible.
    requestAnimationFrame(() => requestAnimationFrame(() => root.classList.add('open')));
    document.body.style.overflow = 'hidden';
    root.querySelector('.tl-close')?.focus();
  }

  function close() {
    if (!isOpen) return;
    isOpen = false;
    root.classList.remove('open');
    document.body.style.overflow = '';
    onClose?.();
    previouslyFocused?.focus?.();
  }

  // Drag by titlebar (desktop pointers; mobile stays centered).
  let drag = null;
  titlebar.addEventListener('pointerdown', (event) => {
    if (!isOpen || event.target.closest('button')) return;
    if (window.innerWidth <= 720) return;
    const rect = root.getBoundingClientRect();
    drag = { dx: event.clientX - rect.left, dy: event.clientY - rect.top };
    root.style.transform = 'none';
    root.style.left = `${rect.left}px`;
    root.style.top = `${rect.top}px`;
    titlebar.setPointerCapture(event.pointerId);
  });
  titlebar.addEventListener('pointermove', (event) => {
    if (!drag) return;
    const width = root.getBoundingClientRect().width;
    root.style.left = `${Math.min(Math.max(event.clientX - drag.dx, -width + 80), window.innerWidth - 80)}px`;
    root.style.top = `${Math.min(Math.max(event.clientY - drag.dy, 0), window.innerHeight - 48)}px`;
  });
  titlebar.addEventListener('pointerup', () => {
    drag = null;
  });

  return { root, body, open, close, get isOpen() { return isOpen; }, setTitle: (text) => (titleNode.textContent = text) };
}

export { clear };
