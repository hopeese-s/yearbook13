import sharp from 'sharp';
import { processImage, newPhotoId } from '../images/pipeline.js';
import { validatePhotoInput, createPhotoRecord } from '../domain/photos.js';
import { logger } from '../util/logger.js';

const EXTENSION_BY_FORMAT = { jpeg: 'jpg', png: 'png', webp: 'webp' };
const VIDEO_EXTS = new Set(['mp4', 'webm', 'mov']);

function safeFilename(name) {
  const base = String(name ?? 'photo').split(/[\\/]/).pop();
  return base.replace(/[^\w.\- ]+/g, '_').slice(0, 120) || 'photo';
}

function isVideoFile(filename = '') {
  const ext = filename.split('.').pop()?.toLowerCase();
  return VIDEO_EXTS.has(ext);
}

async function createVideoPoster(filename) {
  const label = filename.slice(0, 32).replace(/[<>&'"]/g, '');
  const svg = `
    <svg width="640" height="360" viewBox="0 0 640 360" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#0a0c14" />
          <stop offset="50%" stop-color="#14192b" />
          <stop offset="100%" stop-color="#07090e" />
        </linearGradient>
        <radialGradient id="aurora" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stop-color="rgba(41, 151, 255, 0.35)" />
          <stop offset="100%" stop-color="transparent" />
        </radialGradient>
      </defs>
      <rect width="640" height="360" fill="url(#bg)" />
      <circle cx="320" cy="180" r="160" fill="url(#aurora)" />
      <circle cx="320" cy="170" r="44" fill="rgba(255, 255, 255, 0.12)" stroke="rgba(255, 255, 255, 0.25)" stroke-width="2" />
      <polygon points="312,152 336,170 312,188" fill="#ffffff" />
      <text x="320" y="246" text-anchor="middle" fill="#b0b0b8" font-family="-apple-system, sans-serif" font-size="14" font-weight="600">${label}</text>
    </svg>
  `;
  return sharp(Buffer.from(svg)).webp({ quality: 85 }).toBuffer();
}

/**
 * Upload orchestration (Phase 4 + Video Support): pipeline -> storage (full + thumb) ->
 * repository. Any failure after objects are stored cleans them up, so a
 * failed upload never leaves orphan objects or partial metadata.
 */
export function createUploadService({ storage, repository }) {
  async function uploadPhoto({ buffer, originalName, metadata }) {
    const { value: meta, errors } = validatePhotoInput(metadata);
    if (errors.length > 0) {
      throw Object.assign(new Error(errors.join('; ')), { code: 'INVALID_METADATA', status: 400 });
    }

    const id = newPhotoId();
    const isVideo = isVideoFile(originalName);

    let fullBuffer;
    let thumbBuffer;
    let storageKey;
    let thumbKey;
    let width = 640;
    let height = 360;
    let thumbWidth = 480;
    let thumbHeight = 270;

    if (isVideo) {
      const ext = originalName.split('.').pop()?.toLowerCase() || 'mp4';
      storageKey = `photos/full/${id}.${ext}`;
      thumbKey = `photos/thumb/${id}.webp`;
      fullBuffer = buffer;
      thumbBuffer = await createVideoPoster(originalName);
    } else {
      const processed = await processImage(buffer);
      const ext = EXTENSION_BY_FORMAT[processed.format] ?? 'jpg';
      storageKey = `photos/full/${id}.${ext}`;
      thumbKey = `photos/thumb/${id}.${ext}`;
      fullBuffer = processed.full.buffer;
      thumbBuffer = processed.thumb.buffer;
      width = processed.full.width;
      height = processed.full.height;
      thumbWidth = processed.thumb.width;
      thumbHeight = processed.thumb.height;
    }

    const savedKeys = [];
    try {
      await storage.save(storageKey, fullBuffer);
      savedKeys.push(storageKey);
      await storage.save(thumbKey, thumbBuffer);
      savedKeys.push(thumbKey);

      const record = createPhotoRecord(meta, {
        id,
        filename: safeFilename(originalName),
        storageKey,
        thumbKey,
        mediaType: isVideo ? 'video' : 'image',
        width,
        height,
        thumbWidth,
        thumbHeight,
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
