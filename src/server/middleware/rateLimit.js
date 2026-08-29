import rateLimit from 'express-rate-limit';

/**
 * Lightweight fixed-window limiter. Presets come from validated env config:
 * authRateLimit guards /auth/*, uploadRateLimit guards upload endpoints.
 */
export function createRateLimiter({ max, windowMs }) {
  return rateLimit({
    windowMs,
    limit: max,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: { code: 'RATE_LIMITED', message: 'Too many requests; slow down and retry later' } },
  });
}
