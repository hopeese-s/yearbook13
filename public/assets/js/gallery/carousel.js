import { el } from '../ui/dom.js';

/** Coverflow carousel with prev/next navigation and click-to-open. */
export function createCarousel(root, photos, { onOpen } = {}) {
  root.hidden = false;
  root.replaceChildren();

  let index = 0;
  const track = el('div', { class: 'carousel-track' });
  let isDragging = false;
  let startX = 0;
  let startY = 0;
  let currentDeltaX = 0;

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
      if (isDragging) return;
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

  function render(offsetExtra = 0) {
    const firstCard = cards[0];
    if (!firstCard) return;
    const style = window.getComputedStyle(track);
    const gap = parseFloat(style.columnGap || style.gap) || (window.innerWidth <= 720 ? 12 : 24);
    const measuredWidth = firstCard.offsetWidth || Math.min(250, (root.clientWidth || 360) * 0.72);
    const cardWidth = measuredWidth + gap;
    const baseOffset = ((root.clientWidth || 360) - measuredWidth) / 2 - index * cardWidth;
    track.style.transform = `translateX(${baseOffset + offsetExtra}px)`;
    for (const [cardIndex, card] of cards.entries()) {
      card.classList.toggle('is-active', cardIndex === index);
    }
  }

  const carouselEl = el('div', { class: 'carousel' }, track);

  const onTouchStart = (event) => {
    if (event.touches.length !== 1 || photos.length <= 1) return;
    startX = event.touches[0].clientX;
    startY = event.touches[0].clientY;
    isDragging = false;
    currentDeltaX = 0;
    track.style.transition = 'none';
  };

  const onTouchMove = (event) => {
    if (event.touches.length !== 1 || photos.length <= 1) return;
    const dx = event.touches[0].clientX - startX;
    const dy = event.touches[0].clientY - startY;

    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 8) {
      isDragging = true;
      currentDeltaX = dx;
      render(currentDeltaX * 0.75);
    }
  };

  const onTouchEnd = () => {
    track.style.transition = '';
    if (isDragging) {
      if (currentDeltaX < -36 && photos.length > 1) {
        index = (index + 1) % photos.length;
      } else if (currentDeltaX > 36 && photos.length > 1) {
        index = (index - 1 + photos.length) % photos.length;
      }
      render();
      setTimeout(() => {
        isDragging = false;
      }, 50);
    } else {
      render();
    }
    currentDeltaX = 0;
  };

  carouselEl.addEventListener('touchstart', onTouchStart, { passive: true });
  carouselEl.addEventListener('touchmove', onTouchMove, { passive: true });
  carouselEl.addEventListener('touchend', onTouchEnd, { passive: true });
  carouselEl.addEventListener('touchcancel', onTouchEnd, { passive: true });

  const prevBtn = el('button', {
    class: 'btn',
    type: 'button',
    text: '‹',
    'aria-label': 'Previous',
    onclick: () => {
      index = (index - 1 + photos.length) % photos.length;
      render();
    },
  });
  const nextBtn = el('button', {
    class: 'btn',
    type: 'button',
    text: '›',
    'aria-label': 'Next',
    onclick: () => {
      index = (index + 1) % photos.length;
      render();
    },
  });
  const nav = el('div', { class: 'carousel-nav' }, prevBtn, nextBtn);
  if (photos.length <= 1) {
    nav.style.display = 'none';
  }

  root.append(carouselEl, nav);
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
      carouselEl.removeEventListener('touchstart', onTouchStart);
      carouselEl.removeEventListener('touchmove', onTouchMove);
      carouselEl.removeEventListener('touchend', onTouchEnd);
      carouselEl.removeEventListener('touchcancel', onTouchEnd);
      root.replaceChildren();
      root.hidden = true;
    },
  };
}
