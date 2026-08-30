import { el } from '../ui/dom.js';

/**
 * Lightbox: fullscreen dark-glass quick view. Distinct from the Mac Preview
 * window — one tap to zoom a single photo, Escape/click anywhere to dismiss.
 * Escape and click share the same close semantics (owner's onClose runs).
 */
export function createLightbox() {
  let overlay = null;
  let onKeydown = null;

  function close() {
    if (!overlay) return;
    if (onKeydown) document.removeEventListener('keydown', onKeydown);
    overlay.remove();
    overlay = null;
    onKeydown = null;
    document.body.style.overflow = '';
  }

  function open(photo, { onClose } = {}) {
    close();
    overlay = el(
      'div',
      { class: 'lightbox-overlay', role: 'dialog', 'aria-modal': 'true', 'aria-label': photo.caption || 'Photo' },
      el('img', { src: photo.fileUrl, alt: photo.caption || 'Yearbook photo' }),
    );
    overlay.style.cssText = [
      'position:fixed',
      'inset:0',
      'z-index:var(--z-lightbox)',
      'display:flex',
      'align-items:center',
      'justify-content:center',
      'padding:24px',
      'background:rgba(4,5,9,0.78)',
      '-webkit-backdrop-filter:blur(18px) saturate(140%)',
      'backdrop-filter:blur(18px) saturate(140%)',
      'animation:lbIn 220ms cubic-bezier(0.22,1,0.36,1)',
    ].join(';');
    const img = overlay.querySelector('img');
    img.style.cssText = 'max-width:min(1100px,94vw);max-height:92vh;border-radius:18px;box-shadow:0 30px 80px rgba(0,0,0,0.7)';

    const dismiss = () => {
      close();
      onClose?.();
    };
    overlay.addEventListener('click', dismiss);
    onKeydown = (event) => {
      if (event.key === 'Escape') dismiss();
    };
    document.addEventListener('keydown', onKeydown);
    document.body.append(overlay);
    document.body.style.overflow = 'hidden';
  }

  const isOpen = () => Boolean(overlay);
  return { open, close, isOpen };
}

// Shared keyframes (injected once).
const style = document.createElement('style');
style.textContent = '@keyframes lbIn { from { opacity: 0 } to { opacity: 1 } }';
document.head.append(style);
