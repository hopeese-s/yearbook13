import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Router } from 'express';
import express from 'express';
import request from 'supertest';
import { makeTestApp, makeTestConfig } from '../helpers.js';
import { createErrorHandler } from '../../src/server/middleware/errors.js';

function appWithThrowingRoute(config) {
  const app = express();
  const throwing = Router();
  throwing.get('/boom', () => {
    throw new Error('simulated failure');
  });
  app.use(throwing);
  app.use(createErrorHandler(config));
  return app;
}

test('unknown route returns errors.js JSON contract, not the Express default HTML 404', async () => {
  const res = await request(await makeTestApp()).get('/definitely/not/a/route');
  assert.equal(res.status, 404);
  assert.match(res.headers['content-type'], /^application\/json/);
  assert.equal(res.body.error.code, 'NOT_FOUND');
  assert.match(res.body.error.message, /GET \/definitely\/not\/a\/route/);
});

test('unhandled route errors hit the FINAL error handler and return the JSON contract', async () => {
  const app = express();
  const throwing = Router();
  throwing.get('/boom', () => {
    const err = new Error('simulated failure');
    err.status = 418;
    throw err;
  });
  app.use(throwing);
  app.use(createErrorHandler(makeTestConfig()));

  const res = await request(app).get('/boom');
  assert.equal(res.status, 418);
  assert.match(res.headers['content-type'], /^application\/json/);
  assert.equal(res.body.error.code, 'REQUEST_ERROR');
  assert.equal(res.body.error.message, 'simulated failure');
});

test('production error handler suppresses message in response AND logs', async () => {
  const logs = [];
  const originalError = console.error;
  console.error = (...args) => logs.push(args.map(String).join(' '));
  let res;
  try {
    res = await request(appWithThrowingRoute(Object.freeze({ isProd: true }))).get('/boom');
  } finally {
    console.error = originalError;
  }
  assert.equal(res.status, 500);
  assert.equal(res.body.error.code, 'INTERNAL_ERROR');
  assert.equal(res.body.error.message, undefined);
  assert.ok(!logs.some((line) => line.includes('simulated failure')), 'production logs must omit error messages');
});

test('non-production error handler logs the message for debugging', async () => {
  const logs = [];
  const originalError = console.error;
  console.error = (...args) => logs.push(args.map(String).join(' '));
  try {
    await request(appWithThrowingRoute(Object.freeze({ isProd: false }))).get('/boom');
  } finally {
    console.error = originalError;
  }
  assert.ok(logs.some((line) => line.includes('simulated failure')));
});
