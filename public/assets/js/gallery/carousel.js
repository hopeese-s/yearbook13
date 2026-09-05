import { el } from '../ui/dom.js';

/** Coverflow carousel with prev/next navigation and click-to-open. */
export function createCarousel(root, photos, { onOpen } = {}) {
  root.hidden = false;
  root.replaceChildren();

  let index = 0;
  const track = el('div', { class: 'carousel-track' });

  const cards = photos.map((photo, photoIndex) => {
    const isVideo = photo.mediaType === 'video' || /\.(mp4|webm|mov)$/i.test(photo.filename ?? '');
    const card = el(
      'figure',
      {
        class: 'photo-card',
        tabindex: '0',
        role: 'button',
        'aria-label': photo.caption || 'Photo',
      },
      el('img', { src: photo.thumbUrl, alt: photo.caption || 'Yearbook photo', loading: 'lazy' }),
      isVideo ? el('span', { class: 'video-badge', text: '▶ Video' }) : null,
    );
    card.addEventListener('click', () => {
      if (photoIndex === index) onOpen?.(photo);
      else {
        index = photoIndex;
        render();
      }
    });
    card.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        if (photoIndex === index) onOpen?.(photo);
        else {
          index = photoIndex;
          render();
        }
      }
    });
    track.append(card);
    return card;
  });

  function render() {
    const firstCard = cards[0];
    const cardWidth = (firstCard?.offsetWidth || 440) + 24; // measured width + gap
    const offset = (root.clientWidth - (firstCard?.offsetWidth || 440)) / 2 - index * cardWidth;
    track.style.transform = `translateX(${offset}px)`;
    for (const [cardIndex, card] of cards.entries()) {
      card.classList.toggle('is-active', cardIndex === index);
    }
  }

  const prevBtn = el('button', { class: 'btn', type: 'button', text: '‹', 'aria-label': 'Previous', onclick: () => { index = (index - 1 + photos.length) % photos.length; render(); } });
  const nextBtn = el('button', { class: 'btn', type: 'button', text: '›', 'aria-label': 'Next', onclick: () => { index = (index + 1) % photos.length; render(); } });
  const nav = el('div', { class: 'carousel-nav' }, prevBtn, nextBtn);

  root.append(el('div', { class: 'carousel' }, track), nav);
  requestAnimationFrame(() => render());

  const onResize = () => render();
  window.addEventListener('resize', onResize, { passive: true });

  const onKeydown = (event) => {
    if (root.hidden) return;
    if (event.key === 'ArrowLeft') {
      index = (index - 1 + photos.length) % photos.length;
      render();
    } else if (event.key === 'ArrowRight') {
      index = (index + 1) % photos.length;
      render();
    }
  };
  window.addEventListener('keydown', onKeydown);

  return {
    destroy() {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('keydown', onKeydown);
      root.replaceChildren();
      root.hidden = true;
    },
  };
}
