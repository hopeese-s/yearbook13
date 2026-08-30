import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { makeTestApp } from '../helpers.js';
import { resolveAppDependencies } from '../../src/server/app.js';
import { makeTestConfig } from '../helpers.js';

test('GET /health returns 200 with ok status', async () => {
  const res = await request(await makeTestApp()).get('/health');
  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'ok');
  assert.equal(res.body.env, 'test');
  assert.equal(res.body.db_ok, true);
  assert.ok(Number.isInteger(res.body.uptimeSeconds));
});

test('app dependency fallback is config-driven for development', async () => {
  const dependencies = await resolveAppDependencies(makeTestConfig());
  assert.equal(dependencies.storage.name, 'local');
  assert.equal(await dependencies.repository.countPhotos(), 0);
});
