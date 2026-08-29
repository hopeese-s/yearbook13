import express from 'express';
import { applySecurity } from './middleware/security.js';
import { createErrorHandler, notFoundHandler } from './middleware/errors.js';
import { healthRoutes } from './routes/health.routes.js';

/**
 * Assemble the Express app. No business logic lives here.
 * Middleware order contract: security -> routers -> notFound -> errorHandler(LAST).
 *
 * `extraRouters` is an explicit test seam: routers mounted with the built-ins,
 * before the 404/error handlers, so the full middleware order stays testable.
 */
export function createApp(config, { extraRouters = [] } = {}) {
  const app = express();

  applySecurity(app, config);

  // Feature routers mount here in later phases (auth, photos, admin, pages).
  const routers = [healthRoutes(config), ...extraRouters];
  for (const router of routers) app.use(router);

  // 404 for anything unmatched, then the central error handler LAST.
  app.use(notFoundHandler);
  app.use(createErrorHandler(config));

  return app;
}
