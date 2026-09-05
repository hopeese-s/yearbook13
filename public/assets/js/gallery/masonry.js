import { el } from '../ui/dom.js';

function getColumnCount() {
  if (typeof window === 'undefined') return 4;
  const w = window.innerWidth;
  if (w < 320) return 1;
  if (w <= 720) return 2;
  if (w <= 1100) return 3;
  return 4;
}

let activeInstance = null;
let resizeHandlerAttached = false;

function createCard(photo, options = {}) {
  const isVideo = photo.mediaType === 'video' || /\.(mp4|webm|mov)$/i.test(photo.filename ?? '');
  const img = el('img', {
    src: photo.thumbUrl,
    alt: photo.caption || 'Yearbook photo',
    loading: 'lazy',
    decoding: 'async',
  });
  if (photo.width && photo.height) {
    img.style.aspectRatio = `${photo.width} / ${photo.height}`;
  }

  const card = el(
    'figure',
    {
      class: 'photo-card',
      tabindex: '0',
      role: 'button',
      'aria-label': photo.caption || (isVideo ? 'Open video' : 'Open photo'),
      draggable: 'true',
      'data-id': photo.id,
    },
    img,
    isVideo ? el('span', { class: 'video-badge', text: '▶ Video' }) : null,
    photo.caption ? el('figcaption', { text: photo.caption }) : null,
  );

  // HTML5 Drag & Drop for Folders
  card.addEventListener('dragstart', (event) => {
    event.dataTransfer.setData('text/plain', photo.id);
    event.dataTransfer.setData(
      'application/json',
      JSON.stringify({ id: photo.id, collections: photo.collections || [] }),
    );
    event.dataTransfer.effectAllowed = 'copyMove';
    card.classList.add('dragging');
  });
  card.addEventListener('dragend', () => {
    card.classList.remove('dragging');
  });

  card.addEventListener('click', () => options.onOpen?.(photo));
  card.addEventListener('dblclick', () => options.onQuickView?.(photo));
  card.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      options.onOpen?.(photo);
    }
  });

  return card;
}

function distributeCards(instance) {
  const { container, cardEntries } = instance;
  if (!container || !cardEntries || cardEntries.length === 0) {
    container?.replaceChildren();
    return;
  }

  const colCount = getColumnCount();
  instance.colCount = colCount;

  const cols = Array.from({ length: colCount }, () => el('div', { class: 'masonry-col' }));
  const colHeights = new Array(colCount).fill(0);

  for (const { photo, card } of cardEntries) {
    let shortest = 0;
    for (let c = 1; c < colCount; c++) {
      if (colHeights[c] < colHeights[shortest]) {
        shortest = c;
      }
    }
    cols[shortest].append(card);
    const aspect = photo.width && photo.height ? photo.height / photo.width : 1;
    colHeights[shortest] += aspect + 0.05;
  }

  container.replaceChildren(...cols);
}

export function renderMasonry(container, photos, { onOpen, onQuickView } = {}) {
  container.hidden = false;

  if (!photos || photos.length === 0) {
    container.replaceChildren();
    activeInstance = null;
    return;
  }

  const cardEntries = photos.map((photo) => ({
    photo,
    card: createCard(photo, { onOpen, onQuickView }),
  }));

  activeInstance = {
    container,
    cardEntries,
    colCount: 0,
  };

  distributeCards(activeInstance);

  if (typeof window !== 'undefined' && !resizeHandlerAttached) {
    resizeHandlerAttached = true;
    let resizeTimer = null;
    window.addEventListener('resize', () => {
      if (!activeInstance || activeInstance.container.hidden) return;
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (!activeInstance || activeInstance.container.hidden) return;
        const targetCols = getColumnCount();
        if (targetCols !== activeInstance.colCount) {
          distributeCards(activeInstance);
        }
      }, 100);
    });
  }
}
