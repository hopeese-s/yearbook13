import { logger } from '../../util/logger.js';

/**
 * 404 handler -> emits the JSON error contract.
 * Registered after all routers in app.js, BEFORE the error handler.
 */
export function notFoundHandler(req, res) {
  res
    .status(404)
    .json({ error: { code: 'NOT_FOUND', message: `No route for ${req.method} ${req.originalUrl}` } });
}

/**
 * Central error handler factory. The returned middleware MUST remain the
 * FINAL middleware in app.js, after every router and other middleware
 * (BUILD-PLAN.md Phase 0 contract, verified by tests).
 *
 * Never leaks stack traces or secrets: only { code, message } shape,
 * with `message` suppressed entirely in production.
 */
export function createErrorHandler(config) {
  return function errorHandler(err, req, res, next) {
    if (res.headersSent) {
      next(err);
      return;
    }
    const status = Number.isInteger(err?.status) ? err.status : 500;
    const code =
      typeof err?.code === 'string' && err.code ? err.code : status >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_ERROR';
    // In production, log ONLY the safe summary: messages can embed secrets
    // (signed URLs, connection strings). Non-production adds the stack.
    const summary = `${status} ${code} ${req.method} ${req.originalUrl}`;
    if (config.isProd) logger.error(summary);
    else logger.error(summary, err?.stack ?? err?.message);
    const body = { error: { code } };
    if (!config.isProd) body.error.message = err?.message ?? 'Unexpected error';
    res.status(status).json(body);
  };
}
