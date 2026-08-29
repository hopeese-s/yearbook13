import express from 'express';
import helmet from 'helmet';

/**
 * Static security headers + request body limits.
 * Rate limiting middleware is added in Phase 1 (auth) and Phase 4 (upload).
 */
export function applySecurity(app, config) {
  app.disable('x-powered-by');
  // Railway terminates TLS in front of the app; trust the first proxy hop.
  app.set('trust proxy', config.isProd ? 1 : false);
  app.use(helmet());
  app.use(express.json({ limit: config.limits.jsonBodyLimit }));
  app.use(express.urlencoded({ extended: false, limit: config.limits.jsonBodyLimit }));
}
