import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadEnv, ConfigError } from '../src/config/env.js';

// Full valid production baseline (all invariants satisfied).
const prodBase = {
  NODE_ENV: 'production',
  PORT: '3000',
  SESSION_SECRET: 'x'.repeat(48),
  SESSION_STORE: 'sql',
  STORAGE_DRIVER: 'r2',
  DB_DRIVER: 'sql',
  GOOGLE_CLIENT_ID: 'id',
  GOOGLE_CLIENT_SECRET: 'secret',
  GOOGLE_CALLBACK_URL: 'https://example.com/auth/google/callback',
  R2_ACCOUNT_ID: 'acc',
  R2_ACCESS_KEY_ID: 'key',
  R2_SECRET_ACCESS_KEY: 'secret',
  R2_BUCKET: 'bucket',
};

function expectConfigError(source, fragment) {
  assert.throws(() => loadEnv(source), (err) => {
    assert.ok(err instanceof ConfigError, `expected ConfigError, got ${err?.name}`);
    assert.ok(err.message.includes(fragment), `expected message to include "${fragment}", got: ${err.message}`);
    return true;
  });
}

test('development defaults load without any env vars set', () => {
  const config = loadEnv({});
  assert.equal(config.nodeEnv, 'development');
  assert.equal(config.port, 3000);
  assert.equal(config.storage.driver, 'local');
  assert.equal(config.session.store, 'file');
  assert.equal(config.db.driver, 'json');
  assert.equal(config.limits.jsonBodyLimit, '1mb');
});

test('valid production config loads', () => {
  const config = loadEnv(prodBase);
  assert.equal(config.nodeEnv, 'production');
  assert.equal(config.storage.driver, 'r2');
  assert.equal(config.session.store, 'sql');
  assert.equal(config.db.driver, 'sql');
  assert.equal(config.session.secureCookies, true);
  assert.deepEqual(config.auth.adminEmails, []);
});

test('production refuses STORAGE_DRIVER=local (uploads must be persistent)', () => {
  expectConfigError({ ...prodBase, STORAGE_DRIVER: 'local' }, 'STORAGE_DRIVER');
});

test('production refuses SESSION_STORE=file', () => {
  expectConfigError({ ...prodBase, SESSION_STORE: 'file' }, 'SESSION_STORE');
});

test('production refuses SESSION_STORE=memory (no Express MemoryStore in production)', () => {
  expectConfigError({ ...prodBase, SESSION_STORE: 'memory' }, 'SESSION_STORE');
});

test('production refuses missing SESSION_STORE', () => {
  const { SESSION_STORE, ...withoutStore } = prodBase;
  expectConfigError(withoutStore, 'SESSION_STORE');
});

test('production refuses DB_DRIVER=json', () => {
  expectConfigError({ ...prodBase, DB_DRIVER: 'json' }, 'DB_DRIVER');
});

test('production refuses short or missing SESSION_SECRET', () => {
  expectConfigError({ ...prodBase, SESSION_SECRET: 'short' }, 'SESSION_SECRET');
  const { SESSION_SECRET, ...withoutSecret } = prodBase;
  expectConfigError(withoutSecret, 'SESSION_SECRET');
});

test('production refuses missing Google OAuth credentials', () => {
  const { GOOGLE_CLIENT_ID, ...noId } = prodBase;
  expectConfigError(noId, 'GOOGLE_CLIENT_ID');
});

test('production refuses missing R2 credentials when STORAGE_DRIVER=r2', () => {
  const { R2_BUCKET, ...noBucket } = prodBase;
  expectConfigError(noBucket, 'R2_BUCKET');
});

test('invalid enum values are rejected', () => {
  expectConfigError({ NODE_ENV: 'staging' }, 'NODE_ENV');
  expectConfigError({ ...prodBase, STORAGE_DRIVER: 'ftp' }, 'STORAGE_DRIVER');
  expectConfigError({ ...prodBase, SESSION_STORE: 'cookie' }, 'SESSION_STORE');
});

test('numeric limits are validated', () => {
  expectConfigError({ ...prodBase, MAX_UPLOAD_BYTES: 'not-a-number' }, 'MAX_UPLOAD_BYTES');
  expectConfigError({ ...prodBase, AUTH_RATE_LIMIT_WINDOW_MS: '50' }, 'AUTH_RATE_LIMIT_WINDOW_MS');
});

test('body limit format is validated', () => {
  expectConfigError({ ...prodBase, JSON_BODY_LIMIT: 'ten' }, 'JSON_BODY_LIMIT');
});

test('admin email list is parsed and normalized', () => {
  const config = loadEnv({ NODE_ENV: 'development', ADMIN_EMAILS: ' A@Example.com , b@test.io ,,' });
  assert.deepEqual(config.auth.adminEmails, ['a@example.com', 'b@test.io']);
});
