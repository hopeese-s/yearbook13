import { Router } from 'express';
import { requireAdmin } from '../middleware/auth.js';
import { createRateLimiter } from '../middleware/rateLimit.js';

/**
 * Google Drive import (admin-only, upload rate limits apply).
 * POST /api/drive/import  { url, caption?, section?, year?, collections?, tags?, categories? }
 * -> { uploaded: [records], failed: [{name, message}], total }
 *
 * Enabled when GOOGLE_DRIVE_API_KEY is configured; otherwise responds 503
 * with an actionable message (same pattern as OAuth not-configured).
 */
export function driveRoutes({ config, driveImporter }) {
  const router = Router();
  const limiter = createRateLimiter(config.limits.uploadRateLimit);

  const stringOrUndefined = (value) => (typeof value === 'string' && value.trim() ? value.trim() : undefined);

  router.post('/api/drive/import', limiter, requireAdmin, async (req, res, next) => {
    try {
      const body = req.body ?? {};
      const metadata = {};
      const caption = stringOrUndefined(body.caption);
      const section = stringOrUndefined(body.section);
      if (caption !== undefined) metadata.caption = caption;
      if (section !== undefined) metadata.section = section;
      if (body.year !== undefined && body.year !== '') metadata.year = body.year;
      for (const key of ['collections', 'tags', 'categories']) {
        const value = body[key];
        if (Array.isArray(value)) metadata[key] = value;
        else if (typeof value === 'string' && value.trim()) {
          metadata[key] = value.split(',').map((item) => item.trim()).filter(Boolean);
        }
      }

      const result = await driveImporter.importFromDrive({ url: body.url, metadata });
      res.json({ uploaded: result.uploaded, failed: result.failed, total: result.total });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
