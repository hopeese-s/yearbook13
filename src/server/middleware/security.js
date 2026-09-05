import express from 'express';
import helmet from 'helmet';

/**
 * Static security headers + request body limits.
 * Rate limiting middleware is added in Phase 1 (auth) and Phase 4 (upload).
 *
 * CSP notes:
 *  - script-src blob: — Three.js creates inline Web Workers from blob: URLs;
 *    blocking this silently breaks the 3D hero canvas.
 *  - worker-src blob: — same reason (worker-src is the specific directive).
 *  - img-src https: data: blob: — R2/CDN image URLs are cross-origin; data:
 *    and blob: cover thumbnail preview URIs.
 *  - connect-src 'self' — allows fetch() to /api/ and /auth/ endpoints.
 *  All other Helmet protections (HSTS, X-Frame-Options, referrer-policy,
 *  CORP, COOP) remain at their secure defaults.
 */
export function applySecurity(app, config) {
  app.disable('x-powered-by');
  // Railway terminates TLS in front of the app; trust the first proxy hop.
  app.set('trust proxy', config.isProd ? 1 : false);

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          // Three.js needs blob: for inline shader workers.
          scriptSrc: ["'self'", 'blob:'],
          workerSrc: ['blob:'],
          // R2 CDN images are cross-origin; data:/blob: covers preview thumbnails.
          imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
          // fetch() calls to /api/ and /auth/ endpoints.
          connectSrc: ["'self'"],
          frameSrc: ["'self'", 'https://drive.google.com', 'https://*.google.com', 'https://*.googleusercontent.com'],
          mediaSrc: ["'self'", 'https:', 'blob:', 'data:'],
          styleSrc: ["'self'", "'unsafe-inline'"],
          fontSrc: ["'self'"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          formAction: ["'self'"],
          // Force HTTPS in production; allow http: in dev (Railway handles TLS).
          upgradeInsecureRequests: config.isProd ? [] : null,
        },
      },
    }),
  );

  app.use(express.json({ limit: config.limits.jsonBodyLimit }));
  app.use(express.urlencoded({ extended: false, limit: config.limits.jsonBodyLimit }));
}
