import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Router } from 'express';
import request from 'supertest';
import { makeTestApp, makeTestConfig } from '../helpers.js';

// Full valid production baseline (all invariants satisfied).
export const prodBase = {
  NODE_ENV: 'production',
  PORT: '3000',
  SESSION_SECRET: 'x'.repeat(48),
  SESSION_STORE: 'sql',
  DB_DRIVER: 'sql',
  DB_URL: 'postgres://user:pass@host:5432/yearbook',
  STORAGE_DRIVER: 'r2',
  GOOGLE_CLIENT_ID: 'id',
  GOOGLE_CLIENT_SECRET: 'secret',
  GOOGLE_CALLBACK_URL: 'https://example.com/auth/google/callback',
  R2_ACCOUNT_ID: 'acc',
  R2_ACCESS_KEY_ID: 'key',
  R2_SECRET_ACCESS_KEY: 'secret',
  R2_BUCKET: 'bucket',
};

test('unknown route returns errors.js JSON contract, not the Express default HTML 404', async () => {
  const res = await request(makeTestApp()).get('/definitely/not/a/route');
  assert.equal(res.status, 404);
  assert.match(res.headers['content-type'], /^application\/json/);
  assert.equal(res.body.error.code, 'NOT_FOUND');
  assert.match(res.body.error.message, /GET \/definitely\/not\/a\/route/);
});

test('unhandled route errors hit the FINAL error handler and return the JSON contract', async () => {
  const throwing = Router();
  throwing.get('/boom', () => {
    const err = new Error('simulated failure');
    err.status = 418;
    throw err;
  });

  const res = await request(makeTestApp({}, { extraRouters: [throwing] })).get('/boom');
  assert.equal(res.status, 418);
  assert.match(res.headers['content-type'], /^application\/json/);
  assert.equal(res.body.error.code, 'REQUEST_ERROR');
  assert.equal(res.body.error.message, 'simulated failure');
});

test('error handler suppresses error details in responses AND production logs', async () => {
  const throwing = Router();
  throwing.get('/boom', () => {
    throw new Error('secret detail should not leak');
  });

  const logs = [];
  const originalError = console.error;
  console.error = (...args) => logs.push(args.map(String).join(' '));
  let res;
  try {
    res = await request(makeTestApp(prodBase, { extraRouters: [throwing] })).get('/boom');
  } finally {
    console.error = originalError;
  }

  assert.equal(res.status, 500);
  assert.equal(res.body.error.code, 'INTERNAL_ERROR');
  assert.equal(res.body.error.message, undefined);
  assert.ok(!logs.some((line) => line.includes('secret detail should not leak')), 'production logs must omit error messages');
});

test('non-production error logs include the stack for debugging', async () => {
  const throwing = Router();
  throwing.get('/boom', () => {
    throw new Error('dev-only detail');
  });

  const logs = [];
  const originalError = console.error;
  console.error = (...args) => logs.push(args.map(String).join(' '));
  try {
    await request(makeTestApp({ NODE_ENV: 'development' }, { extraRouters: [throwing] })).get('/boom');
  } finally {
    console.error = originalError;
  }
  assert.ok(logs.some((line) => line.includes('dev-only detail')));
});

test('makeTestConfig builds a valid isolated test config', () => {
  const config = makeTestConfig();
  assert.equal(config.nodeEnv, 'test');
  assert.equal(config.isProd, false);
});
