import { el } from '../ui/dom.js';

/** Masonry (Pinterest-style) grid using stored aspect ratios. */
export function renderMasonry(container, photos, { onOpen, onQuickView } = {}) {
  container.hidden = false;
  container.replaceChildren();

  for (const photo of photos) {
    const img = el('img', {
      src: photo.thumbUrl,
      alt: photo.caption || 'Yearbook photo',
      loading: 'lazy',
      decoding: 'async',
    });
    img.addEventListener('load', () => {
      // Grid rows are 8px; span = height + row-gap, floored to keep rhythm.
      const height = img.naturalHeight > 0 ? (img.clientWidth * img.naturalHeight) / img.naturalWidth : 200;
      img.closest('.photo-card')?.style.setProperty('--span', String(Math.max(6, Math.ceil((height + 14) / 8))));
    });

    const card = el(
      'figure',
      { class: 'photo-card', tabindex: '0', role: 'button', 'aria-label': photo.caption || 'Open photo' },
      img,
      photo.caption ? el('figcaption', { text: photo.caption }) : null,
    );
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
