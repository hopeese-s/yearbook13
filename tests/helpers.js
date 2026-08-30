import os from 'node:os';
import path from 'node:path';
import { Router } from 'express';
import { loadEnv } from '../src/config/env.js';
import { createApp } from '../src/server/app.js';
import { requireAdmin } from '../src/server/middleware/auth.js';

export function makeTestConfig(overrides = {}) {
  return loadEnv({
    NODE_ENV: 'test',
    SESSION_SECRET: 't'.repeat(48),
    SESSION_DIR: path.join(os.tmpdir(), 'ims13-test-sessions'),
    UPLOAD_DIR: path.join(os.tmpdir(), 'ims13-test-uploads'),
    DATA_DIR: path.join(os.tmpdir(), `ims13-test-data-${process.pid}-${Date.now()}`),
    ...overrides,
  });
}

export async function makeTestApp(overrides = {}, options = {}) {
  return createApp(makeTestConfig(overrides), options);
}

/** Test seam: drives real session login/logout + admin gating against the mounted app. */
export function testLoginRouter({ email = 'admin@example.com', name = 'Test Admin', role = 'admin' } = {}) {
  const router = Router();
  router.post('/test/login', (req, res, next) => {
    req.login({ googleSub: 'test-sub', email, name, role }, (err) => (err ? next(err) : res.json({ ok: true })));
  });
  router.get('/test/admin-only', requireAdmin, (_req, res) => res.json({ ok: true, admin: true }));
  return router;
}
