import path from 'node:path';
import express, { Router } from 'express';
import { paths } from '../../config/paths.js';

/** Static frontend serving (public gallery + admin shell). */
export function pagesRoutes(config) {
  const router = Router();
  router.use(
    express.static(paths.public, {
      index: 'index.html',
      maxAge: 0,
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('.html') || filePath.endsWith('.js') || filePath.endsWith('.css')) {
          res.setHeader('Cache-Control', 'no-cache, must-revalidate');
        } else if (filePath.includes(`${path.sep}vendor${path.sep}`)) {
          res.setHeader('Cache-Control', 'public, max-age=86400');
        } else if (config.isProd) {
          res.setHeader('Cache-Control', 'public, max-age=3600');
        }
      },
    }),
  );
  return router;
}
