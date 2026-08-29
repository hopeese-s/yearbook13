import express from 'express';
import { applySecurity } from './middleware/security.js';
import { createErrorHandler, notFoundHandler } from './middleware/errors.js';
import { healthRoutes } from './routes/health.routes.js';
import { authRoutes } from './routes/auth.routes.js';
import { createPassport } from '../auth/passport.js';
import { sessionMiddleware } from '../auth/session.js';

/**
 * Assemble the Express app. No business logic lives here.
 * Middleware order contract: security -> session -> passport -> routers ->
 * notFound -> errorHandler(LAST).
 *
 * `extraRouters` is an explicit test seam: routers mounted with the built-ins,
 * before the 404/error handlers, so the full middleware order stays testable.
 */
export function createApp(config, { extraRouters = [] } = {}) {
  const app = express();

  applySecurity(app, config);
  app.use(sessionMiddleware(config));
  const { passport, enabled } = createPassport(config);
  app.use(passport.initialize());
  app.use(passport.session());

  // Feature routers mount here in later phases (photos, admin, pages).
  const routers = [healthRoutes(config), authRoutes(config, passport, enabled), ...extraRouters];
  for (const router of routers) app.use(router);

  // 404 for anything unmatched, then the central error handler LAST.
  app.use(notFoundHandler);
  app.use(createErrorHandler(config));

  return app;
}
