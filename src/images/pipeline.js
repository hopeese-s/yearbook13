import sharp from 'sharp';
import { randomUUID } from 'node:crypto';

/**
 * Image pipeline (BUILD-PLAN.md Phase 4, exact order):
 *   validation -> orientation normalization -> EXIF/privacy strip ->
 *   metadata extraction -> thumbnail generation
 * Storage + repository writes happen in the upload service.
 *
 * sharp strips ALL metadata by default on transform; .rotate() with no
 * arguments auto-orients using the source EXIF orientation, so the output
 * is upright and privacy-clean in one pass.
 */

export const ALLOWED_FORMATS = new Set(['jpeg', 'png', 'webp']);
export const THUMB_WIDTH = 480;
// Decompression-bomb guard: ~100 megapixels is far above any classmate photo.
export const MAX_INPUT_PIXELS = 100_000_000;

export class ImageError extends Error {
  constructor(code, message, status = 400, cause) {
    super(message);
    this.name = 'ImageError';
    this.code = code;
    this.status = status;
    this.cause = cause;
  }
}

export async function processImage(buffer, { maxUploadBytes } = {}) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new ImageError('INVALID_FILE', 'Uploaded file is empty or not a file');
  }
  if (maxUploadBytes && buffer.length > maxUploadBytes) {
    throw new ImageError('PAYLOAD_TOO_LARGE', `File exceeds the ${maxUploadBytes} byte limit`, 413);
  }

  let sourceMeta;
  try {
    sourceMeta = await sharp(buffer, { limitInputPixels: MAX_INPUT_PIXELS }).metadata();
  } catch (err) {
    throw new ImageError('UNSUPPORTED_MEDIA_TYPE', 'File is not a readable image', 415, err);
  }
  if (!ALLOWED_FORMATS.has(sourceMeta.format)) {
    throw new ImageError('UNSUPPORTED_MEDIA_TYPE', `Image format "${sourceMeta.format ?? 'unknown'}" is not allowed`, 415);
  }

  // Orientation normalization + EXIF/privacy strip (full-size master).
  let fullBuffer;
  try {
    fullBuffer = await sharp(buffer, { limitInputPixels: MAX_INPUT_PIXELS }).rotate().toBuffer();
  } catch (err) {
    throw new ImageError('PROCESSING_FAILED', 'Failed to normalize the image', 422, err);
  }

  // Thumbnail generation (bounded width, never enlarged).
  let thumbBuffer;
  try {
    thumbBuffer = await sharp(buffer, { limitInputPixels: MAX_INPUT_PIXELS })
      .rotate()
      .resize({ width: THUMB_WIDTH, withoutEnlargement: true })
      .toBuffer();
  } catch (err) {
    throw new ImageError('PROCESSING_FAILED', 'Failed to generate the thumbnail', 422, err);
  }

  const [fullMeta, thumbMeta] = await Promise.all([
    sharp(fullBuffer).metadata(),
    sharp(thumbBuffer).metadata(),
  ]);

  // Privacy verification: the outputs must carry no EXIF block.
  if (fullMeta.exif || thumbMeta.exif) {
    throw new ImageError('PRIVACY_CHECK_FAILED', 'Output images unexpectedly retain EXIF data', 422);
  }

  return {
    format: fullMeta.format,
    full: { buffer: fullBuffer, width: fullMeta.width, height: fullMeta.height },
    thumb: { buffer: thumbBuffer, width: thumbMeta.width, height: thumbMeta.height },
  };
}

export function newPhotoId() {
  return randomUUID();
}
