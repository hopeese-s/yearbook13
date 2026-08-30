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
    // Multer limit errors carry codes but no status; map them to real HTTP
    // statuses AND meaningful body codes (instead of generic REQUEST_ERROR).
    const MULTIPART_LIMIT_STATUS = {
      LIMIT_FILE_SIZE: 413,
      LIMIT_FILE_COUNT: 413,
      LIMIT_FIELD_VALUE: 400,
      LIMIT_FIELD_COUNT: 400,
      LIMIT_UNEXPECTED_FILE: 400,
      LIMIT_PART_COUNT: 400,
    };
    const isMultipartLimit = typeof err?.code === 'string' && err.code.startsWith('LIMIT_');
    const resolvedStatus = MULTIPART_LIMIT_STATUS[err?.code] ?? (isMultipartLimit ? 400 : status);
    const namedCode =
      err?.code === 'LIMIT_FILE_SIZE' || err?.code === 'LIMIT_FILE_COUNT' ? 'PAYLOAD_TOO_LARGE' : undefined;
    const code = namedCode ?? (typeof err?.code === 'string' && err.code && !isMultipartLimit
      ? err.code
      : resolvedStatus >= 500
        ? 'INTERNAL_ERROR'
        : 'REQUEST_ERROR');
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
