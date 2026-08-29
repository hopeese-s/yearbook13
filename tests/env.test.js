import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadEnv, ConfigError } from '../src/config/env.js';

// Full valid production baseline (all invariants satisfied).
const prodBase = {
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

function expectConfigError(source, fragment) {
  assert.throws(() => loadEnv(source), (err) => {
    assert.ok(err instanceof ConfigError, `expected ConfigError, got ${err?.name}`);
    assert.ok(err.message.includes(fragment), `expected message to include "${fragment}", got: ${err.message}`);
    return true;
  });
}

test('unset NODE_ENV FAILS SAFE to production requirements (no silent invariant bypass)', () => {
  expectConfigError({}, 'SESSION_STORE');
});

test('explicit development config loads with dev defaults', () => {
  const config = loadEnv({ NODE_ENV: 'development' });
  assert.equal(config.nodeEnv, 'development');
  assert.equal(config.port, 3000);
  assert.equal(config.storage.driver, 'local');
  assert.equal(config.session.store, 'file');
  assert.equal(config.db.driver, 'json');
  assert.equal(config.limits.jsonBodyLimit, '1mb');
  assert.equal(config.auth.driveImportEnabled, false);
  assert.equal(config.session.secureCookies, false);
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

test('production refuses missing DB_URL when DB_DRIVER=sql', () => {
  const { DB_URL, ...withoutUrl } = prodBase;
  expectConfigError(withoutUrl, 'DB_URL');
});

test('production refuses short or missing SESSION_SECRET', () => {
  expectConfigError({ ...prodBase, SESSION_SECRET: 'short' }, 'SESSION_SECRET');
  const { SESSION_SECRET, ...withoutSecret } = prodBase;
  expectConfigError(withoutSecret, 'SESSION_SECRET');
});

test('production refuses the SESSION_SECRET placeholder from .env.example', () => {
  expectConfigError({ ...prodBase, SESSION_SECRET: `changeme-${'x'.repeat(40)}` }, 'placeholder');
});

test('production refuses missing Google OAuth credentials (each variable)', () => {
  const { GOOGLE_CLIENT_ID, ...noId } = prodBase;
  expectConfigError(noId, 'GOOGLE_CLIENT_ID');
  const { GOOGLE_CLIENT_SECRET, ...noSecret } = prodBase;
  expectConfigError(noSecret, 'GOOGLE_CLIENT_SECRET');
  const { GOOGLE_CALLBACK_URL, ...noCallback } = prodBase;
  expectConfigError(noCallback, 'GOOGLE_CALLBACK_URL');
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

test('invalid PORT is rejected', () => {
  expectConfigError({ ...prodBase, PORT: 'http' }, 'PORT');
  expectConfigError({ ...prodBase, PORT: '0' }, 'PORT');
});

test('numeric limits are validated', () => {
  expectConfigError({ ...prodBase, MAX_UPLOAD_BYTES: 'not-a-number' }, 'MAX_UPLOAD_BYTES');
  expectConfigError({ ...prodBase, AUTH_RATE_LIMIT_WINDOW_MS: '50' }, 'AUTH_RATE_LIMIT_WINDOW_MS');
});

test('body limit format is validated', () => {
  expectConfigError({ ...prodBase, JSON_BODY_LIMIT: 'ten' }, 'JSON_BODY_LIMIT');
});

test('DRIVE_IMPORT_ENABLED is strictly validated', () => {
  expectConfigError({ ...prodBase, DRIVE_IMPORT_ENABLED: 'yes' }, 'DRIVE_IMPORT_ENABLED');
  assert.equal(loadEnv({ NODE_ENV: 'development', DRIVE_IMPORT_ENABLED: 'true' }).auth.driveImportEnabled, true);
});

test('admin email list is parsed and normalized', () => {
  const config = loadEnv({ NODE_ENV: 'development', ADMIN_EMAILS: ' A@Example.com , b@test.io ,,' });
  assert.deepEqual(config.auth.adminEmails, ['a@example.com', 'b@test.io']);
});
