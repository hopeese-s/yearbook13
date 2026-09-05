import { el, clear } from './dom.js';

/**
 * MacWindow: draggable macOS-style window chrome (Phase 6 Preview shell).
 * Reusable: open/close cycles are safe, Escape only works while open,
 * and the root survives close (re-attached on the next open).
 */
let topZIndex = 100;
let cascadeCount = 0;

export function createMacWindow({ title, onClose, initialOffset = true } = {}) {
  const root = el('div', { class: 'mac-window', role: 'dialog', 'aria-modal': 'false', 'aria-label': title ?? 'Preview' });

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

  function bringToFront() {
    topZIndex += 1;
    root.style.zIndex = String(topZIndex);
  }

  root.addEventListener('pointerdown', () => bringToFront());

  function toggleZoom() {
    if (!isOpen) return;
    zoomed = !zoomed;
    if (zoomed) {
      root.style.width = 'calc(100vw - 32px)';
      root.style.height = 'calc(100vh - 48px)';
      root.style.left = '50%';
      root.style.top = '50%';
      root.style.transform = 'translate(-50%, -50%)';
    } else {
      root.style.width = '';
      root.style.height = '';
      root.style.transform = 'none';
      applyCascadePosition();
    }
  }

  function onKeydown(event) {
    if (event.key === 'Escape' && isOpen) close();
  }

  function applyCascadePosition() {
    if (window.innerWidth <= 720) {
      root.style.left = '50%';
      root.style.top = '50%';
      root.style.transform = 'translate(-50%, -50%)';
      return;
    }
    if (initialOffset) {
      const step = (cascadeCount % 6) * 32;
      const baseLeft = Math.max(20, Math.floor((window.innerWidth - 980) / 2) + step);
      const baseTop = Math.max(30, Math.floor((window.innerHeight - 680) / 2) + step);
      root.style.left = `${baseLeft}px`;
      root.style.top = `${baseTop}px`;
      root.style.transform = 'none';
    }
  }

  function ensureAttached() {
    if (!root.isConnected) {
      document.body.append(root);
      zoomed = false;
      root.style.width = '';
      root.style.height = '';
      applyCascadePosition();
    }
    bringToFront();
    if (!keydownBound) {
      document.addEventListener('keydown', onKeydown);
      keydownBound = true;
    }
  }

  function open() {
    if (isOpen) {
      bringToFront();
      return;
    }
    cascadeCount += 1;
    ensureAttached();
    isOpen = true;
    previouslyFocused = document.activeElement;
    root.style.pointerEvents = 'auto';
    root.style.visibility = 'visible';

    // Double rAF so the transition runs after the node is attached/visible.
    requestAnimationFrame(() => requestAnimationFrame(() => root.classList.add('open')));
    if (window.innerWidth <= 720) {
      document.body.style.overflow = 'hidden';
    }
    root.querySelector('.tl-close')?.focus();
  }

  function close() {
    if (!isOpen) return;
    isOpen = false;
    root.classList.remove('open');
    root.style.pointerEvents = 'none';
    root.style.visibility = 'hidden';

    // Check if any other windows are still open before restoring scroll
    const anyOpen = Boolean(document.querySelector('.mac-window.open'));
    if (!anyOpen) {
      document.body.style.overflow = '';
    }

    if (keydownBound) {
      document.removeEventListener('keydown', onKeydown);
      keydownBound = false;
    }

    onClose?.();
    previouslyFocused?.focus?.();

    // Cleanly remove from DOM after CSS transition finishes
    setTimeout(() => {
      if (!isOpen && root.isConnected) {
        root.remove();
      }
    }, 280);
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

  return { root, body, open, close, bringToFront, get isOpen() { return isOpen; }, setTitle: (text) => (titleNode.textContent = text) };
}

export { clear };
