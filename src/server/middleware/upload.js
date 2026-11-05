import multer from 'multer';
import { ensureTmpDir } from '../../util/tmp.js';

export const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'video/mp4',
  'video/webm',
  'video/quicktime',
]);

/**
 * Multer upload middleware: DISK storage in the OS temp dir (bounded by
 * fileSize), a hard file-count cap, and a MIME allowlist. Magic-byte
 * validation happens again inside the image pipeline (defence in depth).
 *
 * Disk, not memory: with memoryStorage a single 10 x 25 MB request held
 * ~250 MB in RAM. Spooled to disk it costs a few KB of buffers. The route
 * handler deletes every temp file when the request finishes.
 */
export function createUploadMiddleware(config) {
  return multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => {
        ensureTmpDir().then((dir) => cb(null, dir), cb);
      },
    }),
    limits: {
      fileSize: config.storage.maxUploadBytes,
      files: config.storage.maxUploadsPerRequest,
    },
    fileFilter: (_req, file, cb) => {
      if (ALLOWED_MIME_TYPES.has(file.mimetype)) {
        cb(null, true);
        return;
      }
      cb(Object.assign(new Error(`Unsupported upload type: ${file.mimetype}`), { code: 'UNSUPPORTED_MEDIA_TYPE', status: 415 }));
    },
  }).array('photos', config.storage.maxUploadsPerRequest);
}
