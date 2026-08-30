import { Router } from 'express';
import { requireAdmin } from '../middleware/auth.js';
import { createRateLimiter } from '../middleware/rateLimit.js';
import { applyPhotoPatch } from '../../domain/photos.js';

/**
 * Photo API (Phase 4).
 *   GET    /api/photos            public list (filters + pagination)
 *   GET    /api/photos/:id        public single record
 *   GET    /api/photos/:id/file   public original bytes (served from storage)
 *   GET    /api/photos/:id/thumb  public thumbnail bytes
 *   POST   /api/photos            admin upload (multipart, rate limited)
 *   PATCH  /api/photos/:id        admin metadata edit
 *   DELETE /api/photos/:id        admin delete (record + stored objects)
 */
export function photoRoutes({ config, storage, repository, uploadService, uploadMiddleware }) {
  const router = Router();
  const uploadLimiter = createRateLimiter(config.limits.uploadRateLimit);

  const withUrls = (record) => {
    if (!record) return record;
    return {
      ...record,
      fileUrl: storage.publicUrl(record.storageKey) ?? `/api/photos/${record.id}/file`,
      thumbUrl: storage.publicUrl(record.thumbKey) ?? `/api/photos/${record.id}/thumb`,
    };
  };

  const listQuery = (query) => ({
    collection: query.collection,
    tag: query.tag,
    category: query.category,
    section: query.section,
    year: query.year,
    personId: query.personId,
    sort: query.sort === 'oldest' ? 'oldest' : 'newest',
    limit: query.limit,
    offset: query.offset,
  });

  router.get('/api/photos', async (req, res, next) => {
    try {
      const result = await repository.listPhotos(listQuery(req.query));
      res.json({ ...result, items: result.items.map(withUrls) });
    } catch (err) {
      next(err);
    }
  });

  router.get('/api/photos/:id', async (req, res, next) => {
    try {
      const record = await repository.getPhoto(req.params.id);
      if (!record) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Photo not found' } });
      res.json({ photo: withUrls(record) });
    } catch (err) {
      next(err);
    }
  });

  const sendObject = (res, key, fallbackType) => async (record) => {
    if (!record) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Photo not found' } });
    try {
      const bytes = await storage.read(key);
      res.set('Content-Type', fallbackType);
      res.set('Cache-Control', 'public, max-age=31536000, immutable');
      res.send(bytes);
    } catch (err) {
      if (err?.code === 'NOT_FOUND') {
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Object missing from storage' } });
      }
      throw err;
    }
  };

  router.get('/api/photos/:id/file', async (req, res, next) => {
    try {
      const record = await repository.getPhoto(req.params.id);
      await sendObject(res, record?.storageKey, 'application/octet-stream')(record);
    } catch (err) {
      next(err);
    }
  });

  router.get('/api/photos/:id/thumb', async (req, res, next) => {
    try {
      const record = await repository.getPhoto(req.params.id);
      await sendObject(res, record?.thumbKey, 'image/webp')(record);
    } catch (err) {
      next(err);
    }
  });

  router.post('/api/photos', uploadLimiter, requireAdmin, (req, res, next) => {
    uploadMiddleware(req, res, (err) => (err ? next(err) : next()));
  });

  // Route handler placed in its own layer so multer errors reach next(err).
  router.post('/api/photos', async (req, res, next) => {
    try {
      const files = Array.isArray(req.files) ? req.files : [];
      if (files.length === 0) {
        return res.status(400).json({ error: { code: 'NO_FILES', message: 'Attach at least one photo in the "photos" field' } });
      }
      const results = { uploaded: [], failed: [] };
      for (const file of files) {
        try {
          const record = await uploadService.uploadPhoto({
            buffer: file.buffer,
            originalName: file.originalname,
            metadata: {
              caption: req.body.caption,
              section: req.body.section,
              year: req.body.year,
              collections: req.body.collections ? String(req.body.collections).split(',') : undefined,
              tags: req.body.tags ? String(req.body.tags).split(',') : undefined,
              categories: req.body.categories ? String(req.body.categories).split(',') : undefined,
            },
          });
          results.uploaded.push(withUrls(record));
        } catch (err) {
          results.failed.push({ filename: file.originalname, code: err.code ?? 'UPLOAD_FAILED', message: err.message });
        }
      }
      res.status(results.uploaded.length > 0 ? 201 : 422).json(results);
    } catch (err) {
      next(err);
    }
  });

  router.patch('/api/photos/:id', requireAdmin, async (req, res, next) => {
    try {
      const record = await repository.getPhoto(req.params.id);
      if (!record) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Photo not found' } });
      const { value, errors } = applyPhotoPatch(record, req.body ?? {});
      if (errors.length > 0) {
        return res.status(400).json({ error: { code: 'INVALID_METADATA', message: errors.join('; ') } });
      }
      const updated = await repository.updatePhoto(record.id, value);
      res.json({ photo: withUrls(updated) });
    } catch (err) {
      next(err);
    }
  });

  router.delete('/api/photos/:id', requireAdmin, async (req, res, next) => {
    try {
      const record = await repository.getPhoto(req.params.id);
      if (!record) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Photo not found' } });
      await uploadService.deletePhoto(record);
      res.json({ ok: true, id: record.id });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
