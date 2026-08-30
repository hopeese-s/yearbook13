import { el } from '../ui/dom.js';

/** Masonry (Pinterest-style) grid. Spans come from STORED dimensions when
 * available (no lazy-load reflow); the load handler is only a fallback. */
export function renderMasonry(container, photos, { onOpen, onQuickView } = {}) {
  container.hidden = false;
  container.replaceChildren();

  const setSpan = (card, width, height) => {
    if (!width || !height) return;
    const rendered = card.querySelector('img').clientWidth || 230;
    const boxHeight = (rendered * height) / width;
    card.style.setProperty('--span', String(Math.max(6, Math.ceil((boxHeight + 14) / 8))));
  };

  for (const photo of photos) {
    const img = el('img', {
      src: photo.thumbUrl,
      alt: photo.caption || 'Yearbook photo',
      loading: 'lazy',
      decoding: 'async',
    });
    img.addEventListener('load', () => {
      // Fallback when the record lacks stored dimensions.
      if (photo.width && photo.height) return;
      const card = img.closest('.photo-card');
      if (card) setSpan(card, img.naturalWidth, img.naturalHeight);
    });

    const card = el(
      'figure',
      { class: 'photo-card', tabindex: '0', role: 'button', 'aria-label': photo.caption || 'Open photo' },
      img,
      photo.caption ? el('figcaption', { text: photo.caption }) : null,
    );
    // Stored server-side dimensions -> immediate span, no reflow cascade.
    requestAnimationFrame(() => setSpan(card, photo.width, photo.height));
    card.addEventListener('click', () => onOpen?.(photo));
    card.addEventListener('dblclick', () => onQuickView?.(photo));
    card.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        onOpen?.(photo);
      }
    });
    container.append(card);
  }
}
