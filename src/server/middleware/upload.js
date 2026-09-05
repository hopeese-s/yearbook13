import multer from 'multer';

export const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'video/mp4',
  'video/webm',
  'video/quicktime',
]);

/**
 * Multer upload middleware: memory storage (bounded by fileSize), a hard
 * file-count cap, and a MIME allowlist. Magic-byte validation happens again
 * inside the image pipeline (defence in depth).
 */
export function createUploadMiddleware(config) {
  return multer({
    storage: multer.memoryStorage(),
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
