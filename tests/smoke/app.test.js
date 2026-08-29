import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { loadEnv } from '../../src/config/env.js';
import { createApp } from '../../src/server/app.js';

export function makeTestConfig(overrides = {}) {
  return loadEnv({ NODE_ENV: 'test', SESSION_SECRET: 't'.repeat(48), ...overrides });
}

export function makeTestApp(overrides = {}, options = {}) {
  return createApp(makeTestConfig(overrides), options);
}

test('GET /health returns 200 with ok status', async () => {
  const res = await request(makeTestApp()).get('/health');
  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'ok');
  assert.equal(res.body.env, 'test');
  assert.ok(Number.isInteger(res.body.uptimeSeconds));
});
