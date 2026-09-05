import { el, clear } from '../ui/dom.js';

/**
 * Folders Drawer & Manager (Phase 3).
 * Provides a slide-over panel for organizing photos/videos into folders,
 * creating new folders, and moving items via HTML5 drag & drop or click.
 */
export function createFoldersManager({
  drawerRoot,
  backdropRoot,
  toggleBtn,
  onSelectFolder,
  onPhotoMoved,
}) {
  let allPhotos = [];
  const customFolders = new Set();
  let currentFolder = '';

  function getFolders() {
    const fromPhotos = allPhotos.flatMap((p) => p.collections ?? []);
    return [...new Set([...customFolders, ...fromPhotos])].filter(Boolean).sort();
  }

  function open() {
    render();
    drawerRoot.classList.add('open');
    backdropRoot.classList.add('open');
  }

  function close() {
    drawerRoot.classList.remove('open');
    backdropRoot.classList.remove('open');
  }

  toggleBtn?.addEventListener('click', () => {
    if (drawerRoot.classList.contains('open')) close();
    else open();
  });

  backdropRoot?.addEventListener('click', () => close());

  function render() {
    clear(drawerRoot);

    // Header
    const closeBtn = el('button', {
      class: 'btn',
      type: 'button',
      'aria-label': 'Close folders drawer',
      text: '✕',
      onclick: () => close(),
    });
    closeBtn.style.padding = '6px 12px';

    const header = el(
      'div',
      { class: 'folders-drawer-header' },
      el('h3', {}, '📁 Folders'),
      closeBtn,
    );

    // New folder action
    const newFolderBtn = el('button', {
      class: 'btn primary',
      type: 'button',
      text: '+ New Folder',
      onclick: () => promptNewFolder(),
    });
    newFolderBtn.style.marginBottom = '16px';
    newFolderBtn.style.width = '100%';

    // Folder items
    const list = el('div', { class: 'folder-list' });

    // "All Photos" item
    const allItem = el(
      'div',
      {
        class: `folder-item ${currentFolder === '' ? 'active' : ''}`.trim(),
        onclick: () => {
          currentFolder = '';
          onSelectFolder?.('');
          close();
        },
      },
      el('span', { class: 'folder-icon', text: '🗂️' }),
      el(
        'div',
        { class: 'folder-info' },
        el('div', { class: 'folder-name', text: 'All Media' }),
        el('div', { class: 'folder-count', text: `${allPhotos.length} items` }),
      ),
    );
    list.append(allItem);

    const folders = getFolders();
    for (const folder of folders) {
      const count = allPhotos.filter((p) =>
        (p.collections ?? []).some((c) => c.toLowerCase() === folder.toLowerCase()),
      ).length;

      const item = el(
        'div',
        {
          class: `folder-item ${currentFolder.toLowerCase() === folder.toLowerCase() ? 'active' : ''}`.trim(),
          onclick: () => {
            currentFolder = folder;
            onSelectFolder?.(folder);
            close();
          },
        },
        el('span', { class: 'folder-icon', text: '📁' }),
        el(
          'div',
          { class: 'folder-info' },
          el('div', { class: 'folder-name', text: folder }),
          el('div', { class: 'folder-count', text: `${count} items` }),
        ),
      );

      // Drag & drop dropzone
      item.addEventListener('dragover', (event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        item.classList.add('dragover');
      });

      item.addEventListener('dragleave', () => {
        item.classList.remove('dragover');
      });

      item.addEventListener('drop', async (event) => {
        event.preventDefault();
        item.classList.remove('dragover');
        const photoId = event.dataTransfer.getData('text/plain');
        if (!photoId) return;

        const photo = allPhotos.find((p) => p.id === photoId);
        if (!photo) return;

        const existing = photo.collections ?? [];
        if (existing.includes(folder)) return;

        const updatedCollections = [folder];
        try {
          const res = await fetch(`/api/photos/${photoId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ collections: updatedCollections }),
          });
          if (res.ok) {
            photo.collections = updatedCollections;
            render();
            onPhotoMoved?.(photo, folder);
          }
        } catch {
          // ignore
        }
      });

      list.append(item);
    }

    drawerRoot.append(header, newFolderBtn, list);
  }

  function promptNewFolder() {
    const name = window.prompt('Enter new folder name:');
    if (!name?.trim()) return;
    const clean = name.trim();
    customFolders.add(clean);
    currentFolder = clean;
    render();
    onSelectFolder?.(clean);
  }

  return {
    setPhotos(photos) {
      allPhotos = photos;
      render();
    },
    setCurrentFolder(folder) {
      currentFolder = folder;
      render();
    },
    getFolders,
    open,
    close,
  };
}
