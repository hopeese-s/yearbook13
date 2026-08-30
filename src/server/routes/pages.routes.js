import path from 'node:path';
import express, { Router } from 'express';
import { paths } from '../../config/paths.js';

/** Static frontend serving (public gallery + admin shell). */
export function pagesRoutes(config) {
  const router = Router();
  router.use(
    express.static(paths.public, {
      index: 'index.html',
      maxAge: config.isProd ? '1h' : 0,
      setHeaders: (res, filePath) => {
        // Vendored modules are effectively immutable per deploy.
        if (filePath.includes(`${path.sep}vendor${path.sep}`)) {
          res.setHeader('Cache-Control', 'public, max-age=86400');
        }
      },
    }),
  );
  return router;
}
