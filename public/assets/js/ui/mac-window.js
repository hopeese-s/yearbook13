import { el, clear } from './dom.js';

/**
 * MacWindow: draggable macOS-style window chrome (Phase 6 Preview shell).
 * Manages open/close with transitions; content is rendered by the owner.
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
      el('button', { class: 'tl-min', type: 'button', 'aria-label': 'Minimize', onclick: () => close() }),
      el('button', { class: 'tl-zoom', type: 'button', 'aria-label': 'Zoom', onclick: () => toggleZoom() }),
    ),
    titleNode,
  );

  const body = el('div', { class: 'window-body' });
  root.append(titlebar, body);
  document.body.append(root);

  let previouslyFocused = null;
  let zoomed = false;

  function toggleZoom() {
    zoomed = !zoomed;
    root.style.width = zoomed ? 'calc(100vw - 24px)' : '';
    root.style.height = zoomed ? 'calc(100vh - 24px)' : '';
  }

  function open() {
    previouslyFocused = document.activeElement;
    root.classList.add('open');
    document.body.style.overflow = 'hidden';
    const closeBtn = root.querySelector('.tl-close');
    closeBtn?.focus();
  }

  function close() {
    root.classList.remove('open');
    document.body.style.overflow = '';
    onClose?.();
    setTimeout(() => root.remove(), 280);
    previouslyFocused?.focus?.();
    document.removeEventListener('keydown', onKeydown);
    window.removeEventListener('resize', clampPosition);
  }

  function onKeydown(event) {
    if (event.key === 'Escape') close();
  }

  // Drag by titlebar (desktop pointers; mobile stays centered).
  let drag = null;
  titlebar.addEventListener('pointerdown', (event) => {
    if (event.target.closest('button')) return;
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

  function clampPosition() {
    if (drag) return;
    root.style.left = '';
    root.style.top = '';
    root.style.transform = '';
  }

  window.addEventListener('resize', clampPosition, { passive: true });
  document.addEventListener('keydown', onKeydown);

  return { root, body, open, close, setTitle: (text) => (titleNode.textContent = text) };
}

/** Re-exported for tests/detach needs. */
export { clear };
