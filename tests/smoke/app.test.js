import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { makeTestApp } from '../helpers.js';

test('GET /health returns 200 with ok status', async () => {
  const res = await request(await makeTestApp()).get('/health');
  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'ok');
  assert.equal(res.body.env, 'test');
  assert.ok(Number.isInteger(res.body.uptimeSeconds));
});
