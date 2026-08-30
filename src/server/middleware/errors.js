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
    // Multer errors carry codes but no status; map them to real HTTP codes.
    const multerStatus = {
      LIMIT_FILE_SIZE: 413,
      LIMIT_FILE_COUNT: 413,
      LIMIT_UNEXPECTED_FILE: 400,
    }[err?.code];
    const resolvedStatus = Number.isInteger(multerStatus) ? multerStatus : status;
    const code =
      typeof err?.code === 'string' && err.code && !multerStatus
        ? err.code
        : resolvedStatus >= 500
          ? 'INTERNAL_ERROR'
          : 'REQUEST_ERROR';
    // In production, log ONLY the safe summary: messages can embed secrets
    // (signed URLs, connection strings). Non-production adds the stack.
    const summary = `${resolvedStatus} ${code} ${req.method} ${req.originalUrl}`;
    if (config.isProd) logger.error(summary);
    else logger.error(summary, err?.stack ?? err?.message);
    const body = { error: { code } };
    if (!config.isProd) body.error.message = err?.message ?? 'Unexpected error';
    res.status(resolvedStatus).json(body);
  };
}
