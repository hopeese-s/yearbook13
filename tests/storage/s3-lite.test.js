import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createS3LiteClient, signV4 } from '../../src/storage/s3-lite.js';
import { createR2Storage } from '../../src/storage/r2.driver.js';
import { StorageError } from '../../src/storage/driver.js';
import { makeTestConfig } from '../helpers.js';

test('signV4 matches the AWS SigV4 test-suite vector (get-vanilla)', () => {
  const auth = signV4({
    method: 'GET',
    path: '/',
    headers: { host: 'example.amazonaws.com', 'x-amz-date': '20150830T123600Z' },
    payloadHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    accessKeyId: 'AKIDEXAMPLE',
    secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
    region: 'us-east-1',
    service: 'service',
    amzDate: '20150830T123600Z',
  });
  assert.equal(
    auth,
    'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=host;x-amz-date, Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31',
  );
});

/** Tiny in-memory S3 over real HTTP: exercises the real client + driver wiring. */
async function startFakeS3() {
  const objects = new Map();
  const seen = [];
  const server = http.createServer(async (req, res) => {
    seen.push({ method: req.method, url: req.url, headers: req.headers });
    if (!String(req.headers.authorization).startsWith('AWS4-HMAC-SHA256 Credential=key/')) {
      res.writeHead(403).end('<Error><Code>AccessDenied</Code></Error>');
      return;
    }
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const key = decodeURIComponent(req.url);
    if (req.method === 'PUT') {
      objects.set(key, Buffer.concat(chunks));
      res.writeHead(200, { etag: '"x"' }).end();
    } else if (!objects.has(key)) {
      res.writeHead(404).end(req.method === 'HEAD' ? undefined : '<Error><Code>NoSuchKey</Code></Error>');
    } else if (req.method === 'DELETE') {
      objects.delete(key);
      res.writeHead(204).end();
    } else {
      const body = objects.get(key);
      res.writeHead(200, { 'content-length': body.length });
      res.end(req.method === 'HEAD' ? undefined : body);
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, objects, seen, endpoint: `http://127.0.0.1:${server.address().port}` };
}

test('R2 driver over the dependency-free S3 client: save/saveFile/read/stream/exists/delete', async () => {
  const fake = await startFakeS3();
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ims13-s3lite-'));
  try {
    const client = createS3LiteClient({ endpoint: fake.endpoint, accessKeyId: 'key', secretAccessKey: 'secret' });
    const config = makeTestConfig({
      NODE_ENV: 'production',
      SESSION_STORE: 'sql',
      DB_DRIVER: 'sql',
      DB_URL: 'postgres://u:p@h:5432/db',
      STORAGE_DRIVER: 'r2',
      GOOGLE_CLIENT_ID: 'id',
      GOOGLE_CLIENT_SECRET: 'secret',
      GOOGLE_CALLBACK_URL: 'https://example.com/cb',
      R2_ACCOUNT_ID: 'acc',
      R2_ACCESS_KEY_ID: 'key',
      R2_SECRET_ACCESS_KEY: 'secret',
      R2_BUCKET: 'bucket',
    });
    const driver = await createR2Storage(config, { s3Client: client });

    await driver.save('photos/thumb/a b.jpg', Buffer.from('thumb'));
    assert.ok(fake.objects.get('/bucket/photos/thumb/a b.jpg').equals(Buffer.from('thumb')));
    assert.equal(fake.seen.at(-1).headers['content-type'], 'image/jpeg');

    const big = Buffer.alloc(300 * 1024, 9);
    const file = path.join(dir, 'video.bin');
    await fs.writeFile(file, big);
    const saved = await driver.saveFile('photos/full/v.mp4', file);
    assert.equal(saved.size, big.length);
    assert.equal(fake.seen.at(-1).headers['content-length'], String(big.length));
    assert.equal(fake.seen.at(-1).headers['transfer-encoding'], undefined, 'R2 needs a fixed length, not chunked');
    assert.ok(fake.objects.get('/bucket/photos/full/v.mp4').equals(big));

    assert.ok((await driver.read('photos/full/v.mp4')).equals(big));
    const { stream, size } = await driver.readStream('photos/full/v.mp4');
    assert.equal(size, big.length);
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    assert.ok(Buffer.concat(chunks).equals(big));

    assert.equal(await driver.exists('photos/full/v.mp4'), true);
    assert.equal((await driver.stat('photos/full/v.mp4')).size, big.length);
    await driver.delete('photos/full/v.mp4');
    assert.equal(await driver.exists('photos/full/v.mp4'), false);
    await assert.rejects(() => driver.read('photos/full/v.mp4'), (err) => err instanceof StorageError && err.code === 'NOT_FOUND');
  } finally {
    fake.server.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});
