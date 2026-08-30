import { renderState, hide } from './ui/dom.js';
import { initFocusPolicy } from './ui/focus.js';
import { initMenu, initChips } from './ui/menu.js';
import { initTheme } from './ui/theme.js';
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
const viewLabel = document.getElementById('view-label');
const carouselNav = document.getElementById('carousel-nav');
const heroMount = document.getElementById('hero-mount');
const wallCount = document.getElementById('wall-count');
const themeToggle = document.getElementById('theme-toggle');

initFocusPolicy();
initMenu();
initTheme(themeToggle);

let allPhotos = [];
let galleryTotal = 0;
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

let searchQuery = '';
let activePerson = '';
let activeTag = '';

// Read URL parameters (e.g. ?collection=graduation or ?person=alex)
const urlParams = new URLSearchParams(window.location.search);
if (urlParams.has('collection')) activeCollection = urlParams.get('collection');
if (urlParams.has('person')) activePerson = urlParams.get('person');
if (urlParams.has('tag')) activeTag = urlParams.get('tag');
if (urlParams.has('search')) searchQuery = urlParams.get('search');

const searchInput = document.getElementById('gallery-search');
if (searchInput) {
  if (searchQuery) searchInput.value = searchQuery;
  let debounceTimer;
  searchInput.addEventListener('input', (event) => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      searchQuery = event.target.value.trim().toLowerCase();
      renderGallery();
    }, 200);
  });
}

function renderGallery() {
  hide(statePanel);
  let photos = allPhotos;

  if (activeCollection) {
    photos = photos.filter((p) => p.collections?.some((c) => c.toLowerCase() === activeCollection.toLowerCase()));
  }
  if (activePerson) {
    photos = photos.filter((p) => p.personIds?.some((person) => person.toLowerCase() === activePerson.toLowerCase()));
  }
  if (activeTag) {
    photos = photos.filter((p) => p.tags?.some((t) => t.toLowerCase() === activeTag.toLowerCase()));
  }
  if (searchQuery) {
    photos = photos.filter(
      (p) =>
        (p.caption ?? '').toLowerCase().includes(searchQuery) ||
        (p.filename ?? '').toLowerCase().includes(searchQuery) ||
        (p.section ?? '').toLowerCase().includes(searchQuery) ||
        (p.collections ?? []).some((item) => item.toLowerCase().includes(searchQuery)) ||
        (p.tags ?? []).some((item) => item.toLowerCase().includes(searchQuery)) ||
        (p.categories ?? []).some((item) => item.toLowerCase().includes(searchQuery)) ||
        (p.personIds ?? []).some((item) => item.toLowerCase().includes(searchQuery)),
    );
  }

  const countLabel = photos.length === 1 ? 'photograph' : 'photographs';
  wallCount.textContent =
    photos.length === galleryTotal ? `${galleryTotal} ${countLabel}` : `${photos.length} shown · ${galleryTotal} total`;

  if (carouselOn) {
    if (photos.length === 0) {
      carouselRoot.hidden = true;
      masonryRoot.hidden = false;
      renderState(statePanel, {
        kind: 'empty',
        title: 'No matching photos',
        detail: 'Try clearing your search or filters.',
      });
      return;
    }
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
  if (!galleryTotal) return;
  carouselOn = on;
  viewLabel.textContent = on ? 'Wall' : 'Carousel';
  renderGallery();
}

viewToggle.addEventListener('click', () => setViewCarousel(!carouselOn));
carouselNav.addEventListener('click', (event) => {
  event.preventDefault();
  setViewCarousel(true);
  carouselRoot.scrollIntoView({ behavior: 'smooth', block: 'center' });
});

async function boot() {
  try {
    const result = await getPhotos({ limit: 200 });
    allPhotos = result.items ?? [];
    galleryTotal = Number(result.total ?? allPhotos.length);
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
    const chips = initChips(chipsRoot, collections, {
      onSelect: (value) => {
        activeCollection = value;
        chips.setActive(value);
        renderGallery();
      },
    });

    if (activeCollection) chips.setActive(activeCollection);

    // Hero: silent failure — the copy still works without 3D.
    initHero(heroMount, allPhotos).catch(() => {});
    renderGallery();

    // Register Service Worker for PWA support
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
  } catch (err) {
    renderState(statePanel, { kind: 'error', detail: err.message });
  }
}

// Sign-in state in the dock.
authStatus()
  .then((status) => {
    const dock = document.getElementById('dock');
    const signIn = dock?.querySelector('a[href^="/auth/google"]');
    if (!dock) return;

    if (status?.authenticated && status.user) {
      const { name, role } = status.user;

      // Replace the sign-in anchor with the user identity + sign-out button.
      if (signIn) signIn.remove();

      if (role === 'admin') {
        const adminLink = document.createElement('a');
        adminLink.href = '/admin.html';
        adminLink.textContent = `${name} · Admin ↗`;
        dock.append(adminLink);
      } else {
        const nameSpan = document.createElement('span');
        nameSpan.className = 'dock-user';
        nameSpan.textContent = name;
        dock.append(nameSpan);
      }

      const signOutBtn = document.createElement('button');
      signOutBtn.type = 'button';
      signOutBtn.className = 'dock-item';
      signOutBtn.textContent = 'Sign out';
      signOutBtn.addEventListener('click', async () => {
        try { await fetch('/auth/logout', { method: 'POST' }); } catch { /* ignore */ }
        window.location.reload();
      });
      dock.append(signOutBtn);
    }
  })
  .catch(() => {});

boot();
