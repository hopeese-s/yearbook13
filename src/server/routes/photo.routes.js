import { Router } from 'express';
import { requireAdmin } from '../middleware/auth.js';
import { createRateLimiter } from '../middleware/rateLimit.js';
import { applyPhotoPatch } from '../../domain/photos.js';
import { buildZip } from '../../util/zip.js';
import { logger } from '../../util/logger.js';

/**
 * Photo API (Phase 4 + Phase 2 enhancements).
 *   GET    /api/photos            public list (filters + pagination + search)
 *   GET    /api/photos/:id        public single record
 *   GET    /api/photos/:id/file   public original bytes (served from storage)
 *   GET    /api/photos/:id/thumb  public thumbnail bytes
 *   GET    /api/photos/export/zip admin backup ZIP download
 *   POST   /api/photos            admin upload (multipart, rate limited)
 *   POST   /api/photos/bulk       admin bulk metadata patch
 *   POST   /api/photos/bulk-delete admin bulk delete
 *   PATCH  /api/photos/:id        admin metadata edit
 *   DELETE /api/photos/:id        admin delete (record + stored objects)
 */
export function photoRoutes({ config, storage, repository, uploadService, uploadMiddleware }) {
  const router = Router();
  const uploadLimiter = createRateLimiter(config.limits.uploadRateLimit);

  const withUrls = (record) => {
    if (!record) return record;
    const fileUrl =
      record.externalUrl ||
      record.embedUrl ||
      (record.driveFileId ? `https://drive.google.com/file/d/${encodeURIComponent(record.driveFileId)}/preview` : null) ||
      (record.storageKey ? storage.publicUrl(record.storageKey) : null) ||
      `/api/photos/${record.id}/file`;
    const thumbUrl =
      record.externalThumbUrl ||
      (record.thumbKey ? storage.publicUrl(record.thumbKey) : null) ||
      (record.thumbKey ? `/api/photos/${record.id}/thumb` : '') ||
      fileUrl;
    return {
      ...record,
      fileUrl,
      thumbUrl,
    };
  };

  const listQuery = (query) => ({
    collection: query.collection,
    tag: query.tag,
    category: query.category,
    section: query.section,
    year: query.year,
    personId: query.personId,
    search: query.search,
    sort: query.sort === 'oldest' ? 'oldest' : 'newest',
    limit: query.limit,
    offset: query.offset,
  });

  router.get('/api/photos/export/zip', requireAdmin, async (_req, res, next) => {
    try {
      const { items } = await repository.listPhotos({ limit: 9999 });
      const entries = [];
      for (const record of items) {
        try {
          const bytes = await storage.read(record.storageKey);
          const ext = record.filename?.includes('.') ? '' : '.jpg';
          const name = `photos/${record.id}_${record.filename || 'photo'}${ext}`;
          entries.push({ name, data: bytes });
        } catch {
          // ignore missing storage keys
        }
      }
      const zipBuffer = buildZip(entries);
      res.set('Content-Type', 'application/zip');
      res.set('Content-Disposition', 'attachment; filename="ims13-yearbook-backup.zip"');
      res.send(zipBuffer);
    } catch (err) {
      next(err);
    }
  });

  router.post('/api/photos/bulk', requireAdmin, async (req, res, next) => {
    try {
      const { ids = [], patch = {} } = req.body ?? {};
      if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Attach an array of photo ids' } });
      }
      const updated = [];
      const failed = [];
      for (const id of ids) {
        const record = await repository.getPhoto(id);
        if (!record) {
          failed.push({ id, message: 'Photo not found' });
          continue;
        }
        const { value, errors } = applyPhotoPatch(record, patch);
        if (errors.length > 0) {
          failed.push({ id, message: errors.join('; ') });
          continue;
        }
        const saved = await repository.updatePhoto(id, value);
        if (saved) updated.push(withUrls(saved));
      }
      res.json({ updated, failed });
    } catch (err) {
      next(err);
    }
  });

  router.post('/api/photos/bulk-delete', requireAdmin, async (req, res, next) => {
    try {
      const { ids = [] } = req.body ?? {};
      if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Attach an array of photo ids' } });
      }
      const records = [];
      for (const id of ids) {
        const record = await repository.getPhoto(id);
        if (record) records.push(record);
      }
      const result = await uploadService.deletePhotos(records);
      res.json({ ok: true, ...result });
    } catch (err) {
      next(err);
    }
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

  const getMimeType = (key = '', fallback = 'application/octet-stream') => {
    const ext = key.split('.').pop()?.toLowerCase();
    switch (ext) {
      case 'mp4': return 'video/mp4';
      case 'webm': return 'video/webm';
      case 'mov': return 'video/quicktime';
      case 'jpg':
      case 'jpeg': return 'image/jpeg';
      case 'png': return 'image/png';
      case 'webp': return 'image/webp';
      default: return fallback;
    }
  };

  router.get('/api/photos/:id/file', async (req, res, next) => {
    try {
      const record = await repository.getPhoto(req.params.id);
      if (record?.externalUrl) {
        return res.redirect(record.externalUrl);
      }
      if (record?.embedUrl) {
        return res.redirect(record.embedUrl);
      }
      if (record?.driveFileId) {
        return res.redirect(`https://drive.google.com/file/d/${encodeURIComponent(record.driveFileId)}/preview`);
      }
      const mime = getMimeType(record?.storageKey, 'application/octet-stream');
      await sendObject(res, record?.storageKey, mime)(record);
    } catch (err) {
      next(err);
    }
  });

  router.get('/api/photos/:id/thumb', async (req, res, next) => {
    try {
      const record = await repository.getPhoto(req.params.id);
      if (record?.externalThumbUrl) {
        return res.redirect(record.externalThumbUrl);
      }
      await sendObject(res, record?.thumbKey, 'image/webp')(record);
    } catch (err) {
      next(err);
    }
  });

  router.post('/api/photos', uploadLimiter, requireAdmin, (req, res, next) => {
    uploadMiddleware(req, res, (err) => (err ? next(err) : next()));
  });

  // Route handler placed in its own layer so multer errors reach next(err).
  // requireAdmin repeated here as defense in depth: gating must not depend
  // on middleware ordering in the multer layer alone.
  router.post('/api/photos', requireAdmin, async (req, res, next) => {
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
            mimeType: file.mimetype,
            metadata: {
              caption: req.body.caption,
              section: req.body.section,
              year: req.body.year,
              collections: req.body.collections ? String(req.body.collections).split(',') : undefined,
              tags: req.body.tags ? String(req.body.tags).split(',') : undefined,
              categories: req.body.categories ? String(req.body.categories).split(',') : undefined,
              personIds: req.body.personIds ? String(req.body.personIds).split(',') : undefined,
            },
          });
          results.uploaded.push(withUrls(record));
        } catch (err) {
          logger.warn(`Photo/video upload failed: filename="${file.originalname}" code=${err.code ?? 'ERROR'}: ${err.message}`);
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
