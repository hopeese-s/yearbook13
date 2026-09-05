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
    const isVideo = photo.mediaType === 'video' || /\.(mp4|webm|mov)$/i.test(photo.filename ?? '');
    let media;
    if (isVideo) {
      const driveId =
        photo.driveFileId ||
        photo.embedUrl?.match(/\/d\/([a-zA-Z0-9_-]+)/)?.[1] ||
        photo.fileUrl?.match(/\/d\/([a-zA-Z0-9_-]+)/)?.[1];
      const isDrive = Boolean(driveId || photo.embedUrl || photo.fileUrl?.includes('drive.google.com'));

      if (isDrive) {
        const src =
          photo.embedUrl ||
          (driveId ? `https://drive.google.com/file/d/${encodeURIComponent(driveId)}/preview` : photo.fileUrl);
        media = el('iframe', {
          src,
          allow: 'autoplay; fullscreen',
          allowfullscreen: 'true',
          class: 'lightbox-drive-iframe',
          style:
            'width:min(1100px,94vw);height:min(700px,80vh);border:none;border-radius:18px;box-shadow:0 30px 80px rgba(0,0,0,0.7);background:#000;',
        });
      } else {
        media = el('video', { src: photo.fileUrl, controls: 'true', autoplay: 'true', playsinline: 'true' });
        media.style.cssText =
          'max-width:min(1100px,94vw);max-height:92vh;border-radius:18px;box-shadow:0 30px 80px rgba(0,0,0,0.7)';
      }
      media.addEventListener('click', (e) => e.stopPropagation());
    } else {
      media = el('img', { src: photo.fileUrl, alt: photo.caption || 'Yearbook photo' });
      media.style.cssText =
        'max-width:min(1100px,94vw);max-height:92vh;border-radius:18px;box-shadow:0 30px 80px rgba(0,0,0,0.7)';
    }

    overlay = el(
      'div',
      { class: 'lightbox-overlay', role: 'dialog', 'aria-modal': 'true', 'aria-label': photo.caption || 'Media' },
      media,
    );

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
