/**
 * Upload wizard state machine (Phase 7 "Steps").
 * Pure logic — DOM rendering lives in admin.js. Unit-testable in Node.
 *
 * Steps: 0 = select files, 1 = metadata, 2 = review + upload.
 */

export const STEP_COUNT = 3;

export function createUploadSteps(initial = {}) {
  let index = Math.min(Math.max(initial.index ?? 0, 0), STEP_COUNT - 1);
  const files = [...(initial.files ?? [])];
  const metadata = { ...(initial.metadata ?? {}) };

  const listeners = new Set();
  const emit = () => {
    for (const listener of listeners) listener(snapshot());
  };

  function snapshot() {
    return {
      index,
      files: [...files],
      metadata: { ...metadata },
      canAdvance: canAdvance(),
      canGoBack: index > 0,
      isLast: index === STEP_COUNT - 1,
    };
  }

  function canAdvance() {
    if (index === 0) return files.length > 0;
    if (index === 1) return true; // metadata is optional
    return false;
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      listener(snapshot());
      return () => listeners.delete(listener);
    },
    get snapshot() {
      return snapshot();
    },
    addFiles(newFiles) {
      const accepted = newFiles.filter(
        (file) => ['image/jpeg', 'image/png', 'image/webp'].includes(file.type) && !files.some((f) => f.name === file.name && f.size === file.size),
      );
      files.push(...accepted);
      emit();
      return accepted;
    },
    removeFile(name) {
      const position = files.findIndex((file) => file.name === name);
      if (position !== -1) files.splice(position, 1);
      emit();
    },
    clearFiles() {
      files.length = 0;
      emit();
    },
    /** Reorder the batch (insertion caret drop target). */
    moveFile(fromIndex, toIndex) {
      if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= files.length || toIndex >= files.length) return;
      const [moved] = files.splice(fromIndex, 1);
      files.splice(toIndex, 0, moved);
      emit();
    },
    setMetadata(patch) {
      Object.assign(metadata, patch);
      emit();
    },
    next() {
      if (canAdvance() && index < STEP_COUNT - 1) {
        index += 1;
        emit();
      }
    },
    back() {
      if (index > 0) {
        index -= 1;
        emit();
      }
    },
  };
}

/**
 * Insertion caret math (Phase 7 "Insertion Caret/Point").
 * Given pointer X within a horizontal flex-wrap strip, return the insertion
 * index (0..items.length). Pure — testable without DOM.
 */
export function computeInsertIndex(rects, pointerX) {
  for (let index = 0; index < rects.length; index += 1) {
    const rect = rects[index];
    const midpoint = rect.left + rect.width / 2;
    if (pointerX < midpoint) return index;
  }
  return rects.length;
}

/** Marquee selection math (Phase 7 "Marquee"). Pure — testable without DOM. */
export function selectInRect(items, rect) {
  const normalized = {
    left: Math.min(rect.left, rect.right),
    right: Math.max(rect.left, rect.right),
    top: Math.min(rect.top, rect.bottom),
    bottom: Math.max(rect.top, rect.bottom),
  };
  const selected = new Set();
  for (const item of items) {
    const intersects =
      item.left < normalized.right &&
      item.right > normalized.left &&
      item.top < normalized.bottom &&
      item.bottom > normalized.top;
    if (intersects) selected.add(item.id);
  }
  return selected;
}
