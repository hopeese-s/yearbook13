import { processImage, newPhotoId } from '../images/pipeline.js';
import { validatePhotoInput, createPhotoRecord } from '../domain/photos.js';
import { logger } from '../util/logger.js';

const EXTENSION_BY_FORMAT = { jpeg: 'jpg', png: 'png', webp: 'webp' };

function safeFilename(name) {
  const base = String(name ?? 'photo').split(/[\\/]/).pop();
  return base.replace(/[^\w.\- ]+/g, '_').slice(0, 120) || 'photo';
}

/**
 * Upload orchestration (Phase 4): pipeline -> storage (full + thumb) ->
 * repository. Any failure after objects are stored cleans them up, so a
 * failed upload never leaves orphan objects or partial metadata.
 */
export function createUploadService({ storage, repository }) {
  async function uploadPhoto({ buffer, originalName, metadata }) {
    const { value: meta, errors } = validatePhotoInput(metadata);
    if (errors.length > 0) {
      throw Object.assign(new Error(errors.join('; ')), { code: 'INVALID_METADATA', status: 400 });
    }

    const processed = await processImage(buffer);
    const id = newPhotoId();
    const ext = EXTENSION_BY_FORMAT[processed.format] ?? 'jpg';
    const storageKey = `photos/full/${id}.${ext}`;
    const thumbKey = `photos/thumb/${id}.${ext}`;

    const savedKeys = [];
    try {
      await storage.save(storageKey, processed.full.buffer);
      savedKeys.push(storageKey);
      await storage.save(thumbKey, processed.thumb.buffer);
      savedKeys.push(thumbKey);

      const record = createPhotoRecord(meta, {
        id,
        filename: safeFilename(originalName),
        storageKey,
        thumbKey,
        width: processed.full.width,
        height: processed.full.height,
        thumbWidth: processed.thumb.width,
        thumbHeight: processed.thumb.height,
        createdAt: new Date().toISOString(),
      });
      await repository.createPhoto(record);
      return record;
    } catch (err) {
      await Promise.allSettled(savedKeys.map((key) => storage.delete(key)));
      throw err;
    }
  }

  async function deletePhoto(record) {
    await repository.deletePhoto(record.id);
    // Best-effort object deletion, but NEVER silent: a failed storage delete
    // leaves photo bytes behind (privacy lifecycle), so log the exact keys.
    const keys = [record.storageKey, record.thumbKey];
    const results = await Promise.allSettled(keys.map((key) => storage.delete(key)));
    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        logger.warn(`ORPHANED_OBJECT key="${keys[index]}" photo=${record.id}: ${result.reason?.message ?? 'delete failed'}`);
      }
    });
  }

  return { uploadPhoto, deletePhoto };
}
