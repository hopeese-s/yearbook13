import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Router } from 'express';
import request from 'supertest';
import { makeTestApp } from './app.test.js';

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

test('error handler suppresses error details in production', async () => {
  const throwing = Router();
  throwing.get('/boom', () => {
    throw new Error('secret detail should not leak');
  });

  const res = await request(
    makeTestApp(
      {
        NODE_ENV: 'production',
        SESSION_STORE: 'sql',
        STORAGE_DRIVER: 'r2',
        DB_DRIVER: 'sql',
        GOOGLE_CLIENT_ID: 'id',
        GOOGLE_CLIENT_SECRET: 'secret',
        GOOGLE_CALLBACK_URL: 'https://yearbook.example.com/auth/google/callback',
        R2_ACCOUNT_ID: 'acc',
        R2_ACCESS_KEY_ID: 'key',
        R2_SECRET_ACCESS_KEY: 'secret',
        R2_BUCKET: 'bucket',
      },
      { extraRouters: [throwing] },
    ),
  ).get('/boom');
  assert.equal(res.status, 500);
  assert.equal(res.body.error.code, 'INTERNAL_ERROR');
  assert.equal(res.body.error.message, undefined);
});
