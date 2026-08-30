import { Router } from 'express';

/**
 * GET /health - liveness probe used by Railway healthcheck.
 *
 * Returns:
 *   { status: 'ok', env, uptimeSeconds, db_ok }
 *
 * `db_ok` is true when the repository responds to countPhotos() within 2s.
 * It is false (not an error) when the DB is unreachable so Railway can
 * detect database outages via the health endpoint without crashing the probe.
 * `repository` is optional — omitted in tests that don't wire a real DB.
 */
export function healthRoutes(config, { repository } = {}) {
  const router = Router();

  router.get('/health', async (_req, res) => {
    let db_ok = null; // null = not checked (no repository wired)

    if (repository && typeof repository.countPhotos === 'function') {
      try {
        await Promise.race([
          repository.countPhotos(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000)),
        ]);
        db_ok = true;
      } catch {
        db_ok = false;
      }
    }

    const payload = { status: 'ok', env: config.nodeEnv, uptimeSeconds: Math.round(process.uptime()) };
    if (db_ok !== null) payload.db_ok = db_ok;
    res.json(payload);
  });

  return router;
}
