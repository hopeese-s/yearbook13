import { createMacWindow } from '../ui/mac-window.js';
import { el, clear } from '../ui/dom.js';

/**
 * PhotoPreview — stateful Mac Preview-style component (BUILD-PLAN.md R8).
 *
 * State machine: closed -> open -> (zooming | rotating | navigating) -> closed
 * Features: previous/next, zoom (1x-4x), rotate (90 deg steps), keyboard
 * navigation, thumbnail filmstrip sync, Escape/focus handling.
 */
export class PhotoPreview {
  /** @type {{open:boolean,index:number,zoom:number,rotation:number}} */
  #state = { open: false, index: 0, zoom: 1, rotation: 0 };

  #photos;
  #window;
  #stage;
  #filmstrip;

  #slideshowTimer = null;

  constructor(photos) {
    this.#photos = photos;
    this.#window = createMacWindow({ title: 'Preview', onClose: () => this.#onClose() });

    this.#stage = el('div', { class: 'preview-stage' });
    this.#filmstrip = el('div', { class: 'filmstrip', role: 'listbox', 'aria-label': 'Photo filmstrip' });

    const toolbar = el(
      'div',
      { class: 'preview-toolbar', role: 'toolbar', 'aria-label': 'Preview tools' },
      this.#tool('‹', 'Previous photo', () => this.prev()),
      this.#tool('−', 'Zoom out', () => this.setZoom(this.#state.zoom - 0.5)),
      this.#tool('+', 'Zoom in', () => this.setZoom(this.#state.zoom + 0.5)),
      this.#tool('⟳', 'Rotate 90°', () => this.rotate()),
      this.#tool('▶', 'Play slideshow', () => this.toggleSlideshow(), 'slideshow-btn'),
      this.#tool('⟲', 'Reset view', () => this.reset()),
      this.#tool('›', 'Next photo', () => this.next()),
    );

    this.#window.body.append(this.#stage, toolbar, this.#filmstrip);
  }

  #tool(label, ariaLabel, onClick, extraClass = '') {
    return el('button', { class: `tool-btn ${extraClass}`.trim(), type: 'button', 'aria-label': ariaLabel, text: label, onclick: onClick });
  }

  toggleSlideshow() {
    if (this.#slideshowTimer) {
      clearInterval(this.#slideshowTimer);
      this.#slideshowTimer = null;
      const btn = this.#window.body.querySelector('.slideshow-btn');
      if (btn) btn.textContent = '▶';
    } else {
      this.#slideshowTimer = setInterval(() => this.next(), 3500);
      const btn = this.#window.body.querySelector('.slideshow-btn');
      if (btn) btn.textContent = '⏸';
    }
  }

  open(index = 0) {
    this.#state = { open: true, index: this.#clampIndex(index), zoom: 1, rotation: 0 };
    this.#window.open();
    this.#render();
  }

  close() {
    this.#window.close();
    this.#onClose();
  }

  #onClose() {
    if (this.#slideshowTimer) {
      clearInterval(this.#slideshowTimer);
      this.#slideshowTimer = null;
    }
    this.#state.open = false;
  }

  next() {
    if (!this.#state.open) return;
    this.#state.index = (this.#state.index + 1) % this.#photos.length;
    this.reset();
  }

  prev() {
    if (!this.#state.open) return;
    this.#state.index = (this.#state.index - 1 + this.#photos.length) % this.#photos.length;
    this.reset();
  }

  goTo(index) {
    if (!this.#state.open) return;
    this.#state.index = this.#clampIndex(index);
    this.reset();
  }

  setZoom(zoom) {
    if (!this.#state.open) return;
    this.#state.zoom = Math.min(4, Math.max(1, Math.round(zoom * 2) / 2));
    this.#applyTransform();
  }

  rotate() {
    if (!this.#state.open) return;
    this.#state.rotation = (this.#state.rotation + 90) % 360;
    this.#applyTransform();
  }

  reset() {
    this.#state.zoom = 1;
    this.#state.rotation = 0;
    this.#render();
  }

  get state() {
    return { ...this.#state, photo: this.#photos[this.#state.index] ?? null };
  }

  /** Swap the photo set after async load (keeps open state coherent). */
  replacePhotos(photos) {
    this.#photos = photos;
  }

  #clampIndex(index) {
    const count = this.#photos.length;
    if (count === 0) return 0;
    return ((index % count) + count) % count;
  }

  #applyTransform() {
    const img = this.#stage.querySelector('img');
    if (img) img.style.transform = `scale(${this.#state.zoom}) rotate(${this.#state.rotation}deg)`;
  }

  #render() {
    const photo = this.#photos[this.#state.index];
    if (!photo) return;
    this.#window.setTitle(photo.caption || 'Preview');

    clear(this.#stage);
    const img = el('img', {
      src: photo.fileUrl,
      alt: photo.caption || 'Yearbook photo',
      draggable: 'false',
    });
    this.#stage.append(img);
    this.#applyTransform();

    clear(this.#filmstrip);
    this.#photos.forEach((candidate, index) => {
      const thumb = el('img', {
        src: candidate.thumbUrl,
        alt: candidate.caption || `Photo ${index + 1}`,
        role: 'option',
        'aria-selected': String(index === this.#state.index),
      });
      if (index === this.#state.index) thumb.classList.add('current');
      thumb.addEventListener('click', () => this.goTo(index));
      this.#filmstrip.append(thumb);
    });
    this.#filmstrip
      .querySelector('.current')
      ?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
  }

  /** Attach keyboard navigation while open (bound once per instance). */
  bindKeyboard(root = document) {
    root.addEventListener('keydown', (event) => {
      if (!this.#state.open) return;
      const actions = {
        ArrowRight: () => this.next(),
        ArrowLeft: () => this.prev(),
        Escape: () => this.close(),
        '+': () => this.setZoom(this.#state.zoom + 0.5),
        '=': () => this.setZoom(this.#state.zoom + 0.5),
        '-': () => this.setZoom(this.#state.zoom - 0.5),
        r: () => this.rotate(),
        R: () => this.rotate(),
      };
      const action = actions[event.key];
      if (action) {
        event.preventDefault();
        action();
      }
    });
  }
}
