import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';

/**
 * sharp (libvips) costs ~28 MB of resident memory just by being loaded, but
 * it is only needed while an admin uploads. Load it on first use so a server
 * that only serves the gallery never pays for it.
 *
 * Memory tuning for small hosts: libvips defaults (a cache of recent operations
 * plus one worker thread per host CPU) keep tens/hundreds of MB resident after
 * every upload. Uploads are rare and sequential, so trade a little speed for RAM.
 */
let sharpPromise;
export function loadSharp() {
  sharpPromise ??= import('sharp').then(({ default: sharp }) => {
    sharp.cache(false);
    sharp.concurrency(1);
    return sharp;
  });
  return sharpPromise;
}

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

/**
 * `input` is either a Buffer or `{ path }` (a file on disk - preferred, since
 * libvips then reads it incrementally instead of us holding it in RAM).
 * When `outputPath` is given the full-size master is written there and
 * `full.path` is returned instead of `full.buffer`.
 */
export async function processImage(input, { maxUploadBytes, outputPath } = {}) {
  let source;
  let size;
  if (Buffer.isBuffer(input)) {
    source = input;
    size = input.length;
  } else if (input && typeof input.path === 'string') {
    source = input.path;
    size = await fs.stat(input.path).then((st) => st.size, () => 0);
  }
  if (source === undefined || size === 0) {
    throw new ImageError('INVALID_FILE', 'Uploaded file is empty or not a file');
  }
  if (maxUploadBytes && size > maxUploadBytes) {
    throw new ImageError('PAYLOAD_TOO_LARGE', `File exceeds the ${maxUploadBytes} byte limit`, 413);
  }
  const sharp = await loadSharp();
  const open = () => sharp(source, { limitInputPixels: MAX_INPUT_PIXELS });

  let sourceMeta;
  try {
    sourceMeta = await open().metadata();
  } catch (err) {
    throw new ImageError('UNSUPPORTED_MEDIA_TYPE', 'File is not a readable image', 415, err);
  }
  if (!ALLOWED_FORMATS.has(sourceMeta.format)) {
    throw new ImageError('UNSUPPORTED_MEDIA_TYPE', `Image format "${sourceMeta.format ?? 'unknown'}" is not allowed`, 415);
  }

  // Orientation normalization + EXIF/privacy strip (full-size master).
  let fullBuffer;
  try {
    // JPEG: optimiseCoding (sharp's default) makes libjpeg hold the whole
    // image's DCT coefficients in RAM for a second Huffman pass - ~130 MB for
    // a 19 MP photo vs ~25 MB without it. It is lossless (identical pixels);
    // files come out ~5% larger. The explicit format also stops toFile()
    // from guessing the format from the file extension.
    const master = open().rotate();
    if (sourceMeta.format === 'jpeg') master.jpeg({ optimiseCoding: false });
    else master.toFormat(sourceMeta.format);
    if (outputPath) {
      await master.toFile(outputPath);
    } else {
      fullBuffer = await master.toBuffer();
    }
  } catch (err) {
    throw new ImageError('PROCESSING_FAILED', 'Failed to normalize the image', 422, err);
  }

  // Thumbnail generation (bounded width, never enlarged).
  let thumbBuffer;
  try {
    thumbBuffer = await open()
      .rotate()
      .resize({ width: THUMB_WIDTH, withoutEnlargement: true })
      .toBuffer();
  } catch (err) {
    throw new ImageError('PROCESSING_FAILED', 'Failed to generate the thumbnail', 422, err);
  }

  const [fullMeta, thumbMeta] = await Promise.all([
    sharp(outputPath ?? fullBuffer).metadata(),
    sharp(thumbBuffer).metadata(),
  ]);

  // Privacy verification: the outputs must carry no EXIF block.
  if (fullMeta.exif || thumbMeta.exif) {
    throw new ImageError('PRIVACY_CHECK_FAILED', 'Output images unexpectedly retain EXIF data', 422);
  }

  return {
    format: fullMeta.format,
    full: outputPath
      ? { path: outputPath, width: fullMeta.width, height: fullMeta.height }
      : { buffer: fullBuffer, width: fullMeta.width, height: fullMeta.height },
    thumb: { buffer: thumbBuffer, width: thumbMeta.width, height: thumbMeta.height },
  };
}

export function newPhotoId() {
  return randomUUID();
}
