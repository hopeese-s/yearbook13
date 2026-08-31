import { el, renderState } from '../ui/dom.js';
import { initMenu } from '../ui/menu.js';
import { initTheme } from '../ui/theme.js';
import { initScrollspy } from './scrollspy.js';
import { createUploadSteps, computeInsertIndex, selectInRect } from './steps.js';

/** Admin entry: auth gate, upload wizard (steps), management (multi-select + marquee). */

initMenu();
initTheme(document.getElementById('theme-toggle'));

const adminUi = document.getElementById('admin-ui');
const authGate = document.getElementById('auth-gate');
const whoami = document.getElementById('whoami');

/* ---------- Upload wizard ---------- */
const steps = createUploadSteps();
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
  const hint = document.getElementById('batch-hint');
  for (const node of [...strip.querySelectorAll('.batch-item')]) node.remove();

  snapshot.files.forEach((file, index) => {
    const item = el(
      'div',
      { class: 'batch-item', 'data-index': String(index), title: file.name },
      el('img', { src: file.url, alt: file.name }),
      el('span', { class: 'batch-name', text: file.name }),
    );
    strip.append(item);
  });

  hint.hidden = snapshot.files.length < 2;
}

// Drag-to-reorder with insertion caret feedback. Strip-level listeners are
// registered ONCE (delegation) — rebuilds must not stack handlers.
{
  const strip = document.getElementById('batch-strip');
  const caret = document.getElementById('insertion-caret');
  let dragIndex = null;

  strip.addEventListener('pointerdown', (event) => {
    const item = event.target.closest('.batch-item');
    if (!item) return;
    dragIndex = Number(item.dataset.index);
    item.classList.add('dragging');
    caret.classList.add('visible');
    strip.setPointerCapture(event.pointerId);
  });
  strip.addEventListener('pointermove', (event) => {
    if (dragIndex === null) return;
    const nodes = [...strip.querySelectorAll('.batch-item')].filter((node) => Number(node.dataset.index) !== dragIndex);
    const rects = nodes.map((node) => node.getBoundingClientRect());
    const insertAt = computeInsertIndex(rects, event.clientX);
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
  strip.addEventListener('pointercancel', finishDrag);
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
  // Object URL is created BEFORE the state emit so the first render has a src.
  for (const file of [...fileList]) {
    const url = URL.createObjectURL(file);
    const accepted = steps.addFiles([file]);
    if (accepted.length === 0) {
      URL.revokeObjectURL(url);
      continue;
    }
    file.url = url;
  }
}
dropzone.addEventListener('click', () => fileInput.click());
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
  personIds: 'f-personIds',
  categories: 'f-categories',
};
for (const [key, id] of Object.entries(metadataBindings)) {
  document.getElementById(id)?.addEventListener('input', (event) => {
    steps.setMetadata({ [key]: event.target.value });
  });
}

// Wizard nav
nextBtn.addEventListener('click', () => steps.next());
backBtn.addEventListener('click', () => steps.back());

// Upload with progress — files are sent in CHUNKS so large selections never
// hit the server's per-request file cap ("Too many files"). 5 per chunk keeps
// peak memory bounded now that files up to 25 MB are allowed.
const UPLOAD_CHUNK_SIZE = 5;

document.getElementById('upload-btn').addEventListener('click', async () => {
  const snapshot = steps.snapshot;
  if (snapshot.files.length === 0) return;
  const track = document.getElementById('progress-track');
  const fill = document.getElementById('progress-fill');
  const results = document.getElementById('upload-results');
  const button = document.getElementById('upload-btn');
  track.hidden = false;
  fill.style.transform = 'scaleX(0)';
  results.replaceChildren();
  button.disabled = true;

  const meta = snapshot.metadata;
  const buildForm = (files) => {
    const form = new FormData();
    for (const file of files) form.append('photos', file, file.name);
    if (meta.caption) form.append('caption', meta.caption);
    if (meta.section) form.append('section', meta.section);
    if (meta.year) form.append('year', meta.year);
    if (meta.collections) form.append('collections', meta.collections);
    if (meta.tags) form.append('tags', meta.tags);
    if (meta.personIds) form.append('personIds', meta.personIds);
    if (meta.categories) form.append('categories', meta.categories);
    return form;
  };

  const chunks = [];
  for (let index = 0; index < snapshot.files.length; index += UPLOAD_CHUNK_SIZE) {
    chunks.push(snapshot.files.slice(index, index + UPLOAD_CHUNK_SIZE));
  }

  const mark = (ok, name, message) =>
    results.append(el('li', { class: ok ? 'ok' : 'fail', text: `${ok ? '✓' : '✗'} ${name}${message ? ` — ${message}` : ''}` }));

  let uploadedCount = 0;
  let failedCount = 0;

  for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
    const chunk = chunks[chunkIndex];
    const ok = await new Promise((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/photos');
      xhr.upload.addEventListener('progress', (event) => {
        if (event.lengthComputable) {
          const overall = (chunkIndex + event.loaded / event.total) / chunks.length;
          fill.style.transform = `scaleX(${overall})`;
        }
      });
      xhr.addEventListener('load', () => {
        let body = null;
        try {
          body = JSON.parse(xhr.responseText);
        } catch {
          // fall through
        }
        if (xhr.status >= 200 && xhr.status < 300 && body?.uploaded) {
          for (const photo of body.uploaded) mark(true, photo.filename);
          for (const failure of body.failed ?? []) mark(false, failure.filename, failure.message);
          uploadedCount += body.uploaded.length;
          failedCount += (body.failed ?? []).length;
          resolve(true);
        } else {
          for (const file of chunk) mark(false, file.name, body?.error?.message ?? `HTTP ${xhr.status}`);
          failedCount += chunk.length;
          resolve(false);
        }
      });
      xhr.addEventListener('error', () => {
        for (const file of chunk) mark(false, file.name, 'Network error');
        failedCount += chunk.length;
        resolve(false);
      });
      xhr.send(buildForm(chunk));
    });
    fill.style.transform = `scaleX(${(chunkIndex + 1) / chunks.length})`;
    if (!ok && chunkIndex < chunks.length - 1) {
      const retry = window.confirm('A batch failed to upload. Continue with the remaining batches?');
      if (!retry) break;
    }
  }

  button.disabled = false;
  fill.style.transform = 'scaleX(1)';
  results.append(
    el('li', {
      class: uploadedCount > 0 && failedCount === 0 ? 'ok' : 'fail',
      text: `Done — ${uploadedCount} uploaded, ${failedCount} failed.`,
    }),
  );

  if (uploadedCount > 0) {
    // Release object URLs and reset the wizard + visible form fields.
    for (const file of snapshot.files) URL.revokeObjectURL(file.url);
    steps.clearFiles();
    for (const id of Object.values(metadataBindings)) document.getElementById(id).value = '';
    steps.setMetadata({});
    loadPhotos();
  }
});

/* ---------- Google Drive import ---------- */

document.getElementById('drive-import-btn').addEventListener('click', async () => {
  const urlInput = document.getElementById('drive-url');
  const results = document.getElementById('drive-results');
  const track = document.getElementById('drive-progress');
  const fill = document.getElementById('drive-progress-fill');
  const button = document.getElementById('drive-import-btn');
  const url = urlInput.value.trim();

  if (!url) {
    results.replaceChildren(el('li', { class: 'fail', text: '✗ Paste a Google Drive link first.' }));
    return;
  }

  button.disabled = true;
  track.hidden = false;
  fill.style.transform = 'scaleX(0)';
  results.replaceChildren(el('li', { class: 'ok', text: 'Importing from Drive… this can take up to a minute.' }));

  try {
    const res = await fetch('/api/drive/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    const body = await res.json().catch(() => null);
    results.replaceChildren();
    if (res.ok && body) {
      fill.style.transform = 'scaleX(1)';
      for (const photo of body.uploaded ?? []) results.append(el('li', { class: 'ok', text: `✓ ${photo.filename} imported` }));
      for (const failure of body.failed ?? []) results.append(el('li', { class: 'fail', text: `✗ ${failure.name} — ${failure.message}` }));
      if ((body.uploaded?.length ?? 0) === 0 && (body.failed?.length ?? 0) === 0) {
        results.append(el('li', { class: 'fail', text: '✗ No photos found in that link.' }));
      }
      urlInput.value = '';
      await loadPhotos();
    } else {
      results.append(el('li', { class: 'fail', text: `✗ ${body?.error?.message ?? `HTTP ${res.status}`}` }));
    }
  } catch {
    results.append(el('li', { class: 'fail', text: '✗ Network error during import.' }));
  }
  button.disabled = false;
});

/* ---------- Manage: multi-select + marquee ---------- */
const grid = document.getElementById('photo-grid');
const marquee = document.getElementById('marquee');
const selectionCount = document.getElementById('selection-count');
const deleteBtn = document.getElementById('delete-selected');
const bulkEditBtn = document.getElementById('bulk-edit-btn');
const manageState = document.getElementById('manage-state');
let photos = [];
const selected = new Set();

function renderSelection() {
  selectionCount.textContent = `${selected.size} selected`;
  deleteBtn.disabled = selected.size === 0;
  if (bulkEditBtn) bulkEditBtn.disabled = selected.size === 0;
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
  if (!window.confirm(`Delete ${selected.size} photo(s)? This cannot be undone.`)) return;
  deleteBtn.disabled = true;
  let failures = 0;
  for (const id of [...selected]) {
    try {
      const res = await fetch(`/api/photos/${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (!res.ok) {
        failures += 1;
        continue; // keep selected so the user can retry
      }
      selected.delete(id);
    } catch {
      failures += 1;
    }
  }
  await loadPhotos();
  if (failures > 0) window.alert(`${failures} photo(s) could not be deleted. Try again.`);
});

if (bulkEditBtn) {
  bulkEditBtn.addEventListener('click', async () => {
    if (selected.size === 0) return;
    const collectionsInput = window.prompt(`Bulk update ${selected.size} photo(s).\nEnter Collections (comma-separated, or leave blank to keep unchanged):`);
    if (collectionsInput === null) return;
    const tagsInput = window.prompt('Enter Tags (comma-separated, or leave blank to keep unchanged):');
    if (tagsInput === null) return;
    const personInput = window.prompt('Enter Tagged Friends (comma-separated, or leave blank to keep unchanged):');
    if (personInput === null) return;

    const patch = {};
    if (collectionsInput.trim()) patch.collections = collectionsInput.split(',').map((s) => s.trim()).filter(Boolean);
    if (tagsInput.trim()) patch.tags = tagsInput.split(',').map((s) => s.trim()).filter(Boolean);
    if (personInput.trim()) patch.personIds = personInput.split(',').map((s) => s.trim()).filter(Boolean);

    if (Object.keys(patch).length === 0) return;

    try {
      const res = await fetch('/api/photos/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [...selected], patch }),
      });
      if (res.ok) {
        window.alert('Bulk update completed successfully!');
        await loadPhotos();
      } else {
        const body = await res.json().catch(() => null);
        window.alert(`Bulk update failed: ${body?.error?.message ?? res.status}`);
      }
    } catch {
      window.alert('Network error during bulk update.');
    }
  });
}

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

/* ---------- Sign-out button ---------- */
const signoutBtn = document.getElementById('signout');
if (signoutBtn) {
  signoutBtn.addEventListener('click', async () => {
    try {
      await fetch('/auth/logout', { method: 'POST' });
    } catch {
      // fall through — session may already be gone
    }
    window.location.href = '/';
  });
}

/* ---------- Drive config loader ---------- */
async function loadDriveConfig() {
  const shareHint = document.getElementById('drive-share-hint');
  const saEmailEl = document.getElementById('drive-sa-email');
  const copyBtn = document.getElementById('copy-sa-email');
  if (!shareHint || !saEmailEl || !copyBtn) return;

  try {
    const config = await fetch('/api/drive/config').then((res) => res.json());
    if (config?.mode === 'service-account' && config.serviceAccountEmail) {
      saEmailEl.textContent = config.serviceAccountEmail;
      shareHint.hidden = false;
      copyBtn.onclick = async () => {
        try {
          await navigator.clipboard.writeText(config.serviceAccountEmail);
          const orig = copyBtn.textContent;
          copyBtn.textContent = 'Copied!';
          setTimeout(() => {
            copyBtn.textContent = orig;
          }, 2000);
        } catch {
          // fallback
        }
      };
    } else {
      shareHint.hidden = true;
    }
  } catch {
    shareHint.hidden = true;
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
      loadDriveConfig();
    } else {
      // Server-side gate handles the redirect; this is a JS-side safety net.
      authGate.hidden = false;
    }
  } catch {
    authGate.hidden = false;
  }
}

boot();

