import express from 'express';
import { applySecurity } from './middleware/security.js';
import { createErrorHandler, notFoundHandler } from './middleware/errors.js';
import { healthRoutes } from './routes/health.routes.js';
import { authRoutes } from './routes/auth.routes.js';
import { photoRoutes } from './routes/photo.routes.js';
import { driveRoutes } from './routes/drive.routes.js';
import { pagesRoutes } from './routes/pages.routes.js';
import { createUploadMiddleware } from './middleware/upload.js';
import { createUploadService } from '../uploads/upload.service.js';
import { createDriveImportService } from '../services/drive-import.js';
import { createPassport } from '../auth/passport.js';
import { sessionMiddleware } from '../auth/session.js';
import { createStorage } from '../storage/index.js';
import { createRepository } from '../data/index.js';

/**
 * Assemble the Express app. No business logic lives here.
 * Middleware order contract: security -> session -> passport -> routers ->
 * notFound -> errorHandler(LAST).
 *
 * Dependencies (storage/repository) are injected; the sync local/JSON pair
 * is the development default. `extraRouters` is an explicit test seam.
 */
export async function resolveAppDependencies(config, { storage, repository } = {}) {
  return {
    storage: storage ?? (await createStorage(config)),
    repository: repository ?? (await createRepository(config)),
  };
}

export async function createApp(config, { extraRouters = [], storage, repository, driveFetchImpl } = {}) {
  const app = express();

  applySecurity(app, config);
  app.use(await sessionMiddleware(config));
  const { passport, enabled } = createPassport(config);
  app.use(passport.initialize());
  app.use(passport.session());

  const dependencies = await resolveAppDependencies(config, { storage, repository });
  const resolvedStorage = dependencies.storage;
  const resolvedRepository = dependencies.repository;
  const uploadService = createUploadService({ storage: resolvedStorage, repository: resolvedRepository });
  const uploadMiddleware = createUploadMiddleware(config);
  const driveImporter = createDriveImportService({ config, uploadService, fetchImpl: driveFetchImpl });

  const routers = [
    healthRoutes(config, { repository: resolvedRepository }),
    authRoutes(config, passport, enabled),
    photoRoutes({ config, storage: resolvedStorage, repository: resolvedRepository, uploadService, uploadMiddleware }),
    driveRoutes({ config, driveImporter }),
    pagesRoutes(config),
    ...extraRouters,
  ];
  for (const router of routers) app.use(router);

  // 404 for anything unmatched, then the central error handler LAST.
  app.use(notFoundHandler);
  app.use(createErrorHandler(config));

  return app;
}
