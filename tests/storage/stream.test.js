import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { StorageError } from '../../src/storage/driver.js';
import { createLocalStorage } from '../../src/storage/local.driver.js';
import { makeTestConfig } from '../helpers.js';

async function collect(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

test('local readStream streams bytes with the correct size (no full buffering path)', async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ims13-stream-'));
  try {
    const driver = createLocalStorage(makeTestConfig(), { rootDir });
    const payload = Buffer.alloc(256 * 1024, 7);
    await driver.save('photos/full/big.mp4', payload);

    const { stream, size } = await driver.readStream('photos/full/big.mp4');
    assert.equal(size, payload.length);
    assert.ok((await collect(stream)).equals(payload));
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
});

test('local readStream rejects NOT_FOUND for a missing object', async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ims13-stream-'));
  try {
    const driver = createLocalStorage(makeTestConfig(), { rootDir });
    await assert.rejects(
      () => driver.readStream('photos/full/missing.mp4'),
      (err) => err instanceof StorageError && err.code === 'NOT_FOUND',
    );
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
});
