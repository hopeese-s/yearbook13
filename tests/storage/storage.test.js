import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createLocalStorage } from '../../src/storage/local.driver.js';
import { createR2Storage } from '../../src/storage/r2.driver.js';
import { StorageError, normalizeKey } from '../../src/storage/driver.js';
import { makeTestConfig } from '../helpers.js';

/** Runs the full driver contract against any implementation. */
async function runStorageContract(t, driver) {
  await t.test('save + read round trip', async () => {
    const key = 'photos/full/abc-123.jpg';
    const buffer = Buffer.from('fake-jpeg-bytes-123');
    const saved = await driver.save(key, buffer);
    assert.equal(saved.key, key);
    assert.equal(saved.size, buffer.length);
    const read = await driver.read(key);
    assert.ok(Buffer.isBuffer(read));
    assert.ok(read.equals(buffer));
  });

  await t.test('read missing object throws NOT_FOUND', async () => {
    await assert.rejects(() => driver.read('photos/full/missing.jpg'), (err) => {
      assert.ok(err instanceof StorageError);
      assert.equal(err.code, 'NOT_FOUND');
      return true;
    });
  });

  await t.test('exists + stat report accurate state', async () => {
    const key = 'photos/thumb/abc-123.jpg';
    assert.equal(await driver.exists(key), false);
    await driver.save(key, Buffer.from('thumb-bytes'));
    assert.equal(await driver.exists(key), true);
    const stats = await driver.stat(key);
    assert.equal(stats.key, key);
    assert.equal(stats.size, 'thumb-bytes'.length);
  });

  await t.test('delete removes object and is a safe no-op when absent', async () => {
    const key = 'photos/full/to-delete.jpg';
    await driver.save(key, Buffer.from('bye'));
    await driver.delete(key);
    assert.equal(await driver.exists(key), false);
    await driver.delete(key); // no-op, must not throw
  });

  await t.test('keys are normalized (dedup slashes, trimmed)', async () => {
    const saved = await driver.save('photos//full///x.jpg', Buffer.from('a'));
    assert.equal(saved.key, 'photos/full/x.jpg');
    assert.equal(await driver.exists('photos/full/x.jpg'), true);
  });

  await t.test('traversal keys are rejected', async () => {
    for (const bad of ['../escape.jpg', 'photos/../../escape.jpg', '/absolute.jpg', 'C:\\evil.jpg', '..\\escape.jpg']) {
      await assert.rejects(() => driver.save(bad, Buffer.from('x')), (err) => {
        assert.equal(err.code, 'INVALID_KEY');
        return true;
      });
    }
  });

  await t.test('empty keys are rejected', async () => {
    await assert.rejects(() => driver.save('', Buffer.from('x')), (err) => err.code === 'INVALID_KEY');
    await assert.rejects(() => driver.save(null, Buffer.from('x')), (err) => err.code === 'INVALID_KEY');
  });
}

test('local driver satisfies the StorageDriver contract', async (t) => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ims13-storage-'));
  const driver = createLocalStorage(makeTestConfig(), { rootDir });
  await runStorageContract(t, driver);

  await t.test('local writes are atomic (no temp files left behind)', async () => {
    await driver.save('atomic/check.jpg', Buffer.from('data'));
    const dir = path.join(rootDir, 'atomic');
    const files = await fs.readdir(dir);
    assert.deepEqual(files, ['check.jpg']);
  });

  await t.test('local keys cannot escape the root (resolved-path guard)', async () => {
    // normalizeKey blocks '..' before resolution; assert the error type here too
    await assert.rejects(() => driver.save('a/b/../../../etc/passwd'), (err) => err.code === 'INVALID_KEY');
  });
});

test('r2 driver satisfies the StorageDriver contract (fake S3 client)', async (t) => {
  // Minimal in-memory S3 backend dispatched on command constructor name.
  const store = new Map();
  const fakeClient = {
    async send(command) {
      const name = command.constructor.name;
      const { Key, Bucket } = command.input;
      assert.equal(Bucket, 'test-bucket');
      switch (name) {
        case 'PutObjectCommand':
          store.set(Key, Buffer.from(command.input.Body));
          return {};
        case 'GetObjectCommand': {
          if (!store.has(Key)) {
            const err = new Error('NotFound');
            err.name = 'NotFound';
            throw err;
          }
          return { Body: { transformToByteArray: async () => new Uint8Array(store.get(Key)) } };
        }
        case 'HeadObjectCommand': {
          if (!store.has(Key)) {
            const err = new Error('NotFound');
            err.name = 'NotFound';
            err.$metadata = { httpStatusCode: 404 };
            throw err;
          }
          return { ContentLength: store.get(Key).length };
        }
        case 'DeleteObjectCommand':
          store.delete(Key);
          return {};
        default:
          throw new Error(`Unexpected command: ${name}`);
      }
    },
  };

  const config = makeTestConfig({
    NODE_ENV: 'production',
    SESSION_STORE: 'sql',
    DB_DRIVER: 'sql',
    DB_URL: 'postgres://user:pass@host:5432/yearbook',
    STORAGE_DRIVER: 'r2',
    GOOGLE_CLIENT_ID: 'id',
    GOOGLE_CLIENT_SECRET: 'secret',
    GOOGLE_CALLBACK_URL: 'https://example.com/cb',
    R2_ACCOUNT_ID: 'acc',
    R2_ACCESS_KEY_ID: 'key',
    R2_SECRET_ACCESS_KEY: 'secret',
    R2_BUCKET: 'test-bucket',
    R2_PUBLIC_BASE_URL: 'https://cdn.example.com/',
  });
  const driver = await createR2Storage(config, { s3Client: fakeClient });
  await runStorageContract(t, driver);

  await t.test('publicUrl uses the configured CDN base', () => {
    assert.equal(driver.publicUrl('photos/full/x.jpg'), 'https://cdn.example.com/photos/full/x.jpg');
  });
});

test('normalizeKey edge cases', () => {
  assert.equal(normalizeKey('photos/full/a.jpg'), 'photos/full/a.jpg');
  assert.equal(normalizeKey('a//b///c'), 'a/b/c');
  // Leading/trailing slashes are absolute or sloppy paths -> rejected strictly.
  assert.throws(() => normalizeKey('/leading/and/trailing/'), StorageError);
  assert.throws(() => normalizeKey(''), StorageError);
  assert.throws(() => normalizeKey(42), StorageError);
});

test('storage factory refuses unknown drivers', async () => {
  await assert.rejects(() => import('../../src/storage/index.js').then((m) => m.createStorage({ storage: { driver: 'ftp' } })), (err) => err.code === 'INVALID_DRIVER');
});
