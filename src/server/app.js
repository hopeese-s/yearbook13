import path from 'node:path';
import express from 'express';
import { applySecurity } from './middleware/security.js';
import { createErrorHandler, notFoundHandler } from './middleware/errors.js';
import { healthRoutes } from './routes/health.routes.js';
import { authRoutes } from './routes/auth.routes.js';
import { photoRoutes } from './routes/photo.routes.js';
import { createUploadMiddleware } from './middleware/upload.js';
import { createUploadService } from '../uploads/upload.service.js';
import { createPassport } from '../auth/passport.js';
import { sessionMiddleware } from '../auth/session.js';
import { createLocalStorage } from '../storage/local.driver.js';
import { createJsonRepository } from '../data/json.repository.js';
import { paths } from '../config/paths.js';

/**
 * Assemble the Express app. No business logic lives here.
 * Middleware order contract: security -> session -> passport -> routers ->
 * notFound -> errorHandler(LAST).
 *
 * Dependencies (storage/repository) are injected; the sync local/JSON pair
 * is the development default. `extraRouters` is an explicit test seam.
 */
export function createApp(config, { extraRouters = [], storage, repository } = {}) {
  const app = express();

  applySecurity(app, config);
  app.use(sessionMiddleware(config));
  const { passport, enabled } = createPassport(config);
  app.use(passport.initialize());
  app.use(passport.session());

  const resolvedStorage = storage ?? createLocalStorage(config);
  const resolvedRepository = repository ?? createJsonRepository({ file: path.join(paths.data(config), 'photos.json') });
  const uploadService = createUploadService({ storage: resolvedStorage, repository: resolvedRepository });
  const uploadMiddleware = createUploadMiddleware(config);

  const routers = [
    healthRoutes(config),
    authRoutes(config, passport, enabled),
    photoRoutes({ config, storage: resolvedStorage, repository: resolvedRepository, uploadService, uploadMiddleware }),
    ...extraRouters,
  ];
  for (const router of routers) app.use(router);

  // 404 for anything unmatched, then the central error handler LAST.
  app.use(notFoundHandler);
  app.use(createErrorHandler(config));

  return app;
}
