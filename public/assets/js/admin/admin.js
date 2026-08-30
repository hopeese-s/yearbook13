import { renderState } from '../ui/dom.js';
import { initMenu } from '../ui/menu.js';
import { initScrollspy } from './scrollspy.js';
import { createUploadSteps, computeInsertIndex, selectInRect } from './steps.js';

/** Admin entry: auth gate, upload wizard (steps), management (multi-select + marquee). */

initMenu();

const adminUi = document.getElementById('admin-ui');
const authGate = document.getElementById('auth-gate');
const whoami = document.getElementById('whoami');

/* ---------- Upload wizard ---------- */
const steps = createUploadSteps();
const files = []; // keep File objects for the POST
const stepPanes = [...document.querySelectorAll('.step-pane')].sort((a, b) => Number(a.dataset.step) - Number(b.dataset.step));
const nextBtn = document.getElementById('next-btn');
const backBtn = document.getElementById('back-btn');
const stepsBar = document.getElementById('steps');

function renderStepsBar(snapshot) {
  stepsBar.replaceChildren();
  const labels = ['Choose photos', 'Describe', 'Review & upload'];
  labels.forEach((label, index) => {
    const state = index < snapshot.index ? 'done' : index === snapshot.index ? 'current' : '';
    stepsBar.append(
      el(
        'div',
        { class: `step ${state}`.trim() },
        el('span', { class: 'dot', text: index < snapshot.index ? '✓' : String(index + 1) }),
        el('span', { text: label }),
      ),
    );
    if (index < labels.length - 1) stepsBar.append(el('span', { class: 'step-arrow', text: '→' }));
  });
}

function renderBatchStrip(snapshot) {
  const strip = document.getElementById('batch-strip');
  const caret = document.getElementById('insertion-caret');
  const hint = document.getElementById('batch-hint');
  for (const node of [...strip.querySelectorAll('.batch-item')]) node.remove();

  snapshot.files.forEach((file, index) => {
    const item = el(
      'div',
      { class: 'batch-item', draggable: 'false', 'data-index': String(index), title: file.name },
      el('img', { src: file.url, alt: file.name }),
      el('span', { class: 'batch-name', text: file.name }),
    );
    strip.append(item);
  });

  hint.hidden = snapshot.files.length < 2;
  caret.className = 'insertion-caret';

  // Drag-to-reorder with insertion caret feedback.
  let dragIndex = null;
  for (const item of strip.querySelectorAll('.batch-item')) {
    item.addEventListener('pointerdown', () => {
      dragIndex = Number(item.dataset.index);
      item.classList.add('dragging');
      caret.classList.add('visible');
    });
  }
  strip.addEventListener('pointermove', (event) => {
    if (dragIndex === null) return;
    const rects = [...strip.querySelectorAll('.batch-item')]
      .filter((node) => Number(node.dataset.index) !== dragIndex)
      .map((node) => node.getBoundingClientRect());
    const insertAt = computeInsertIndex(rects, event.clientX);
    const nodes = [...strip.querySelectorAll('.batch-item')];
    const anchor = nodes[insertAt] ?? null;
    const stripRect = strip.getBoundingClientRect();
    caret.style.left = `${(anchor ? anchor.getBoundingClientRect().left : stripRect.right - 14) - stripRect.left}px`;
    caret.dataset.insert = String(insertAt);
  });
  const finishDrag = () => {
    if (dragIndex === null) return;
    const insertAt = Number(caret.dataset.insert ?? dragIndex);
    const adjusted = insertAt > dragIndex ? insertAt - 1 : insertAt;
    steps.moveFile(dragIndex, adjusted);
    dragIndex = null;
    caret.classList.remove('visible');
  };
  strip.addEventListener('pointerup', finishDrag);
  strip.addEventListener('pointerleave', finishDrag);
}

function renderStepPanes(snapshot) {
  stepPanes.forEach((pane, index) => {
    pane.hidden = index !== snapshot.index;
  });
  nextBtn.textContent = snapshot.isLast ? 'Review' : 'Next';
  nextBtn.disabled = !snapshot.canAdvance;
  backBtn.disabled = !snapshot.canGoBack;
  if (snapshot.isLast) {
    document.getElementById('review-summary').textContent = `${snapshot.files.length} photo(s) ready for upload.`;
  }
}

steps.subscribe((snapshot) => {
  renderStepsBar(snapshot);
  renderStepPanes(snapshot);
  renderBatchStrip(snapshot);
});

// Dropzone
const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('file-input');
function addFiles(fileList) {
  for (const file of steps.addFiles([...fileList])) {
    files.push(file);
    file.url = URL.createObjectURL(file);
  }
}
dropzone.addEventListener('click', () => fileInput.click());
dropzone.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' || event.key === ' ') fileInput.click();
});
dropzone.addEventListener('dragover', (event) => {
  event.preventDefault();
  dropzone.classList.add('dragover');
});
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
dropzone.addEventListener('drop', (event) => {
  event.preventDefault();
  dropzone.classList.remove('dragover');
  addFiles(event.dataTransfer.files);
});
fileInput.addEventListener('change', () => {
  addFiles(fileInput.files);
  fileInput.value = '';
});

// Metadata fields
const metadataBindings = {
  caption: 'f-caption',
  section: 'f-section',
  year: 'f-year',
  collections: 'f-collections',
  tags: 'f-tags',
  categories: 'f-categories',
};
for (const [key, id] of Object.entries(metadataBindings)) {
  document.getElementById(id).addEventListener('input', (event) => {
    steps.setMetadata({ [key]: event.target.value });
  });
}

// Wizard nav
nextBtn.addEventListener('click', () => steps.next());
backBtn.addEventListener('click', () => steps.back());

// Upload with progress (XHR for progress events)
document.getElementById('upload-btn').addEventListener('click', () => {
  const snapshot = steps.snapshot;
  if (snapshot.files.length === 0) return;
  const track = document.getElementById('progress-track');
  const fill = document.getElementById('progress-fill');
  const results = document.getElementById('upload-results');
  const button = document.getElementById('upload-btn');
  track.hidden = false;
  fill.style.width = '0%';
  results.replaceChildren();
  button.disabled = true;

  const form = new FormData();
  for (const file of snapshot.files) form.append('photos', file, file.name);
  const meta = snapshot.metadata;
  if (meta.caption) form.append('caption', meta.caption);
  if (meta.section) form.append('section', meta.section);
  if (meta.year) form.append('year', meta.year);
  if (meta.collections) form.append('collections', meta.collections);
  if (meta.tags) form.append('tags', meta.tags);
  if (meta.categories) form.append('categories', meta.categories);

  const xhr = new XMLHttpRequest();
  xhr.open('POST', '/api/photos');
  xhr.upload.addEventListener('progress', (event) => {
    if (event.lengthComputable) fill.style.width = `${Math.round((event.loaded / event.total) * 100)}%`;
  });
  xhr.addEventListener('load', () => {
    button.disabled = false;
    let body = null;
    try {
      body = JSON.parse(xhr.responseText);
    } catch {
      // fall through
    }
    if (xhr.status >= 200 && xhr.status < 300 && body?.uploaded) {
      for (const photo of body.uploaded) results.append(el('li', { class: 'ok', text: `✓ ${photo.filename} uploaded` }));
      for (const failure of body.failed ?? []) {
        results.append(el('li', { class: 'fail', text: `✗ ${failure.filename}: ${failure.message}` }));
      }
      steps.clearFiles();
      steps.setMetadata({});
      loadPhotos();
    } else {
      results.append(el('li', { class: 'fail', text: `✗ Upload failed: ${body?.error?.message ?? xhr.status}` }));
    }
  });
  xhr.addEventListener('error', () => {
    button.disabled = false;
    results.append(el('li', { class: 'fail', text: '✗ Network error during upload' }));
  });
  xhr.send(form);
});

/* ---------- Manage: multi-select + marquee ---------- */
const grid = document.getElementById('photo-grid');
const marquee = document.getElementById('marquee');
const selectionCount = document.getElementById('selection-count');
const deleteBtn = document.getElementById('delete-selected');
const manageState = document.getElementById('manage-state');
let photos = [];
const selected = new Set();

function renderSelection() {
  selectionCount.textContent = `${selected.size} selected`;
  deleteBtn.disabled = selected.size === 0;
  for (const node of grid.querySelectorAll('.grid-item')) {
    node.classList.toggle('selected', selected.has(node.dataset.id));
  }
}

function renderGrid() {
  for (const node of [...grid.querySelectorAll('.grid-item')]) node.remove();
  for (const photo of photos) {
    const item = el(
      'div',
      {
        class: 'grid-item',
        'data-id': photo.id,
        role: 'checkbox',
        'aria-checked': 'false',
        tabindex: '0',
        'aria-label': photo.caption || 'Photo',
      },
      el('img', { src: photo.thumbUrl, alt: photo.caption || 'Yearbook photo', loading: 'lazy' }),
      el('span', { class: 'item-caption', text: photo.caption || photo.filename }),
    );
    item.addEventListener('click', (event) => {
      if (event.ctrlKey || event.metaKey) {
        if (selected.has(photo.id)) selected.delete(photo.id);
        else selected.add(photo.id);
      } else {
        selected.clear();
        selected.add(photo.id);
      }
      renderSelection();
    });
    item.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        if (selected.has(photo.id)) selected.delete(photo.id);
        else selected.add(photo.id);
        renderSelection();
      }
    });
    grid.append(item);
  }
  renderSelection();
}

// Marquee: drag on the grid's empty space.
let marqueeStart = null;
grid.addEventListener('pointerdown', (event) => {
  if (event.target.closest('.grid-item')) return;
  marqueeStart = { x: event.clientX, y: event.clientY };
  const gridRect = grid.getBoundingClientRect();
  marquee.style.display = 'block';
  marquee.style.left = `${marqueeStart.x - gridRect.left}px`;
  marquee.style.top = `${marqueeStart.y - gridRect.top}px`;
  marquee.style.width = '0px';
  marquee.style.height = '0px';
  grid.setPointerCapture(event.pointerId);
});
grid.addEventListener('pointermove', (event) => {
  if (!marqueeStart) return;
  const gridRect = grid.getBoundingClientRect();
  const rect = {
    left: marqueeStart.x - gridRect.left,
    top: marqueeStart.y - gridRect.top,
    right: event.clientX - gridRect.left,
    bottom: event.clientY - gridRect.top,
  };
  marquee.style.left = `${Math.min(rect.left, rect.right)}px`;
  marquee.style.top = `${Math.min(rect.top, rect.bottom)}px`;
  marquee.style.width = `${Math.abs(rect.right - rect.left)}px`;
  marquee.style.height = `${Math.abs(rect.bottom - rect.top)}px`;

  const itemRects = [...grid.querySelectorAll('.grid-item')].map((node) => {
    const box = node.getBoundingClientRect();
    return { id: node.dataset.id, left: box.left - gridRect.left, right: box.right - gridRect.left, top: box.top - gridRect.top, bottom: box.bottom - gridRect.top };
  });
  selected.clear();
  for (const id of selectInRect(itemRects, rect)) selected.add(id);
  renderSelection();
});
const endMarquee = () => {
  if (!marqueeStart) return;
  marqueeStart = null;
  marquee.style.display = 'none';
};
grid.addEventListener('pointerup', endMarquee);
grid.addEventListener('pointerleave', endMarquee);

document.getElementById('select-all').addEventListener('click', () => {
  selected.clear();
  for (const photo of photos) selected.add(photo.id);
  renderSelection();
});

deleteBtn.addEventListener('click', async () => {
  if (selected.size === 0) return;
  const count = selected.size;
  if (!window.confirm(`Delete ${count} photo(s)? This cannot be undone.`)) return;
  deleteBtn.disabled = true;
  for (const id of [...selected]) {
    try {
      await fetch(`/api/photos/${encodeURIComponent(id)}`, { method: 'DELETE' });
      selected.delete(id);
    } catch {
      // keep the id selected; the next delete attempt can retry
    }
  }
  await loadPhotos();
});

async function loadPhotos() {
  renderState(manageState, { kind: 'loading', detail: 'Loading photos…' });
  try {
    const result = await fetch('/api/photos?limit=200').then((res) => res.json());
    photos = result.items ?? [];
    manageState.hidden = photos.length > 0;
    if (photos.length === 0) {
      renderState(manageState, { kind: 'empty', title: 'No photos yet', detail: 'Upload some first.' });
    }
    renderGrid();
  } catch {
    renderState(manageState, { kind: 'error' });
  }
}

/* ---------- Boot: auth gate ---------- */
async function boot() {
  try {
    const status = await fetch('/auth/status').then((res) => res.json());
    if (status?.authenticated && status.user?.role === 'admin') {
      whoami.textContent = `${status.user.name} (${status.user.email})`;
      adminUi.hidden = false;
      initScrollspy(document.getElementById('admin-nav'), [...document.querySelectorAll('.admin-panel')]);
      loadPhotos();
    } else {
      authGate.hidden = false;
    }
  } catch {
    authGate.hidden = false;
  }
}

boot();
