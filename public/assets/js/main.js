import { renderState, hide } from './ui/dom.js';
import { initFocusPolicy } from './ui/focus.js';
import { initMenu, initChips } from './ui/menu.js';
import { getPhotos, authStatus } from './api.js';
import { renderMasonry } from './gallery/masonry.js';
import { createCarousel } from './gallery/carousel.js';
import { PhotoPreview } from './gallery/preview.js';
import { createLightbox } from './gallery/lightbox.js';
import { initHero } from './three/hero.js';

/** Public gallery entry: boot the Experience surface. */

const statePanel = document.getElementById('gallery-state');
const masonryRoot = document.getElementById('masonry');
const carouselRoot = document.getElementById('carousel-root');
const chipsRoot = document.getElementById('collection-chips');
const viewToggle = document.getElementById('view-carousel');
const heroMount = document.getElementById('hero-mount');

initFocusPolicy();
initMenu();

let allPhotos = [];
let activeCollection = '';
let carousel = null;
let carouselOn = false;

const preview = new PhotoPreview([]);
preview.bindKeyboard();
const lightbox = createLightbox();

function openPreview(photo) {
  const index = Math.max(0, allPhotos.findIndex((candidate) => candidate.id === photo.id));
  preview.open(index);
}

function openQuickView(photo) {
  lightbox.open(photo);
}

function renderGallery() {
  hide(statePanel);
  const photos = activeCollection
    ? allPhotos.filter((photo) => photo.collections?.some((c) => c.toLowerCase() === activeCollection.toLowerCase()))
    : allPhotos;

  if (carouselOn) {
    masonryRoot.hidden = true;
    if (carousel) carousel.destroy();
    carousel = createCarousel(carouselRoot, photos, { onOpen: openPreview });
  } else {
    carousel?.destroy();
    carousel = null;
    carouselRoot.hidden = true;
    // Single click -> Mac Preview window; double click -> fullscreen quick view.
    renderMasonry(masonryRoot, photos, { onOpen: openPreview, onQuickView: openQuickView });
  }
}

function setViewCarousel(on) {
  carouselOn = on;
  viewToggle.textContent = on ? 'Wall' : 'Carousel';
  renderGallery();
}

viewToggle.addEventListener('click', () => setViewCarousel(!carouselOn));

async function boot() {
  try {
    const result = await getPhotos({ limit: 120 });
    allPhotos = result.items ?? [];
    preview.replacePhotos?.(allPhotos);

    if (allPhotos.length === 0) {
      renderState(statePanel, {
        kind: 'empty',
        title: 'No photos yet',
        detail: 'The yearbook is waiting for its first photo.',
      });
      return;
    }

    const collections = [...new Set(allPhotos.flatMap((photo) => photo.collections ?? []))];
    initChips(chipsRoot, collections, {
      onSelect: (value) => {
        activeCollection = value;
        renderGallery();
      },
    });

    // Hero: silent failure — the copy still works without 3D.
    initHero(heroMount, allPhotos).catch(() => {});
    renderGallery();
  } catch (err) {
    renderState(statePanel, { kind: 'error', detail: err.message });
  }
}

// Sign-in state in the dock.
authStatus()
  .then((status) => {
    const signIn = document.querySelector('#dock a[href^="/auth/google"]');
    if (status?.authenticated && signIn) {
      signIn.textContent = status.user.role === 'admin' ? `${status.user.name} · Admin` : status.user.name;
      signIn.setAttribute('href', '/admin.html');
    }
  })
  .catch(() => {});

boot();
