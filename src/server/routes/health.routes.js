import { Router } from 'express';

/** GET /health - liveness probe used by Railway healthcheck. */
export function healthRoutes(config) {
  const router = Router();
  router.get('/health', (_req, res) => {
    res.json({ status: 'ok', env: config.nodeEnv, uptimeSeconds: Math.round(process.uptime()) });
  });
  return router;
}
