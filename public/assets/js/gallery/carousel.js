import { el } from '../ui/dom.js';

/** Coverflow carousel with prev/next navigation, smooth drag, wheel, and click-to-open. */
export function createCarousel(root, photos, { onOpen } = {}) {
  root.hidden = false;
  root.replaceChildren();

  if (!Array.isArray(photos) || photos.length === 0) {
    return {
      destroy() {
        root.replaceChildren();
        root.hidden = true;
      },
    };
  }

  let index = 0;
  const track = el('div', { class: 'carousel-track' });
  let isPointerDown = false;
  let isDragging = false;
  let startX = 0;
  let startY = 0;
  let currentDeltaX = 0;

  const cards = photos.map((photo, photoIndex) => {
    const isVideo = photo.mediaType === 'video' || /\.(mp4|webm|mov)$/i.test(photo.filename ?? '');
    const imgEl = el('img', {
      src: photo.thumbUrl,
      alt: photo.caption || 'Yearbook photo',
      loading: 'lazy',
      draggable: 'false',
    });
    const card = el(
      'figure',
      {
        class: 'photo-card',
        tabindex: '0',
        role: 'button',
        'aria-label': photo.caption || photo.filename || 'Photo',
        draggable: 'false',
      },
      imgEl,
      isVideo ? el('span', { class: 'video-badge', text: '▶ Video' }) : null,
    );

    card.addEventListener('click', (event) => {
      if (isDragging) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (photoIndex === index) {
        onOpen?.(photo);
      } else {
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

  const carouselEl = el('div', { class: 'carousel' }, track);

  const prevBtn = el('button', {
    class: 'btn',
    type: 'button',
    text: '‹',
    'aria-label': 'Previous',
    onclick: () => {
      if (index > 0) {
        index--;
        render();
      }
    },
  });

  const nextBtn = el('button', {
    class: 'btn',
    type: 'button',
    text: '›',
    'aria-label': 'Next',
    onclick: () => {
      if (index < photos.length - 1) {
        index++;
        render();
      }
    },
  });

  const nav = el('div', { class: 'carousel-nav' }, prevBtn, nextBtn);
  if (photos.length <= 1) {
    nav.style.display = 'none';
  }

  function render(offsetExtra = 0) {
    if (cards.length === 0) return;
    index = Math.max(0, Math.min(cards.length - 1, index));
    const activeCard = cards[index];
    if (!activeCard) return;

    // Use activeCard's exact DOM offset and width for pixel-perfect centering
    const containerWidth = carouselEl.clientWidth || root.clientWidth || window.innerWidth;
    const cardCenter = activeCard.offsetLeft + activeCard.offsetWidth / 2;
    const baseOffset = containerWidth / 2 - cardCenter;

    track.style.transform = `translateX(${baseOffset + offsetExtra}px)`;

    for (const [cardIndex, card] of cards.entries()) {
      card.classList.toggle('is-active', cardIndex === index);
    }

    prevBtn.disabled = index === 0;
    nextBtn.disabled = index === cards.length - 1;
  }

  // --- Unified Pointer Drag (Touch + Mouse) ---
  const onPointerDown = (event) => {
    if (photos.length <= 1) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;

    isPointerDown = true;
    isDragging = false;
    startX = event.clientX;
    startY = event.clientY;
    currentDeltaX = 0;
    track.style.transition = 'none';
    try {
      carouselEl.setPointerCapture(event.pointerId);
    } catch {
      // fallback
    }
  };

  const onPointerMove = (event) => {
    if (!isPointerDown) return;
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;

    if (!isDragging && Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 6) {
      isDragging = true;
    }

    if (isDragging) {
      currentDeltaX = dx;
      // Gentle rubber-band resistance when pulling beyond bounds
      let damping = 1;
      if ((index === 0 && dx > 0) || (index === photos.length - 1 && dx < 0)) {
        damping = 0.28;
      }
      render(currentDeltaX * damping);
    }
  };

  const onPointerUp = () => {
    if (!isPointerDown) return;
    isPointerDown = false;

    track.style.transition = '';
    if (isDragging) {
      if (currentDeltaX < -38 && index < photos.length - 1) {
        index++;
      } else if (currentDeltaX > 38 && index > 0) {
        index--;
      }
      render();
      setTimeout(() => {
        isDragging = false;
      }, 80);
    } else {
      render();
    }
    currentDeltaX = 0;
  };

  carouselEl.addEventListener('pointerdown', onPointerDown);
  carouselEl.addEventListener('pointermove', onPointerMove);
  carouselEl.addEventListener('pointerup', onPointerUp);
  carouselEl.addEventListener('pointercancel', onPointerUp);

  // --- Horizontal Wheel / Trackpad Scroll ---
  let wheelTimeout = null;
  const onWheel = (event) => {
    if (photos.length <= 1) return;
    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.shiftKey ? event.deltaY : 0;
    if (Math.abs(delta) < 20) return;
    event.preventDefault();

    if (wheelTimeout) return;
    wheelTimeout = setTimeout(() => {
      wheelTimeout = null;
    }, 240);

    if (delta > 0 && index < photos.length - 1) {
      index++;
      render();
    } else if (delta < 0 && index > 0) {
      index--;
      render();
    }
  };
  carouselEl.addEventListener('wheel', onWheel, { passive: false });

  root.append(carouselEl, nav);
  requestAnimationFrame(() => render());

  const onResize = () => render();
  window.addEventListener('resize', onResize, { passive: true });

  const onKeydown = (event) => {
    if (root.hidden) return;
    if (event.key === 'ArrowLeft') {
      if (index > 0) {
        index--;
        render();
      }
    } else if (event.key === 'ArrowRight') {
      if (index < photos.length - 1) {
        index++;
        render();
      }
    }
  };
  window.addEventListener('keydown', onKeydown);

  return {
    destroy() {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('keydown', onKeydown);
      carouselEl.removeEventListener('pointerdown', onPointerDown);
      carouselEl.removeEventListener('pointermove', onPointerMove);
      carouselEl.removeEventListener('pointerup', onPointerUp);
      carouselEl.removeEventListener('pointercancel', onPointerUp);
      carouselEl.removeEventListener('wheel', onWheel);
      root.replaceChildren();
      root.hidden = true;
    },
  };
}
