import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import request from 'supertest';
import { createDriveImportService } from '../../src/services/drive-import.js';
import { createUploadService } from '../../src/uploads/upload.service.js';
import { makeTestApp, makeTestConfig, testLoginRouter } from '../helpers.js';

const KEY = { GOOGLE_DRIVE_API_KEY: 'test-drive-key' };

async function makeJpeg(width = 40, height = 30) {
  return sharp({ create: { width, height, channels: 3, background: 'teal' } }).jpeg().toBuffer();
}

function fakeStorage() {
  return {
    name: 'fake',
    save: async (key) => ({ key, size: 1 }),
    read: async () => Buffer.alloc(0),
    delete: async () => {},
    exists: async () => true,
    stat: async (key) => ({ key, size: 1 }),
    publicUrl: () => null,
  };
}

function fakeRepository() {
  const photos = [];
  return {
    photos,
    createPhoto: async (record) => {
      photos.push(record);
      return record;
    },
    getPhoto: async (id) => photos.find((r) => r.id === id) ?? null,
    listPhotos: async () => ({ items: photos, total: photos.length, limit: 50, offset: 0 }),
    updatePhoto: async (_id, patch) => patch,
    deletePhoto: async (id) => photos.some((r) => r.id === id),
    countPhotos: async () => photos.length,
  };
}

/** Fake Drive API: dispatches on the URL shape, backed by the given files. */
function fakeDriveFetch(filesById) {
  return async (url) => {
    if (url.includes('parents')) {
      return { ok: true, json: async () => ({ files: Object.values(filesById).map((f) => f.meta) }) };
    }
    if (url.includes('fields=')) {
      const id = decodeURIComponent(url.split('/files/')[1].split('?')[0]);
      const file = filesById[id];
      return { ok: Boolean(file), status: file ? 200 : 404, json: async () => file?.meta };
    }
    if (url.includes('alt=media')) {
      const id = decodeURIComponent(url.split('/files/')[1].split('?')[0]);
      const file = filesById[id];
      if (!file) return { ok: false, status: 404, json: async () => ({}) };
      const copy = Buffer.from(file.bytes);
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () => copy.buffer.slice(copy.byteOffset, copy.byteOffset + copy.byteLength),
      };
    }
    return { ok: false, status: 400, json: async () => ({}) };
  };
}

function serviceWith(filesById) {
  return createDriveImportService({
    config: makeTestConfig(KEY),
    uploadService: createUploadService({ storage: fakeStorage(), repository: fakeRepository() }),
    fetchImpl: fakeDriveFetch(filesById),
  });
}

test('drive import imports every image behind a folder link (filters the rest)', async () => {
  const jpeg = await makeJpeg(30, 20);
  const png = await sharp({ create: { width: 30, height: 20, channels: 3, background: 'red' } }).png().toBuffer();
  const service = serviceWith({
    img1aaaaaaaaaaaa: { meta: { id: 'img1aaaaaaaaaaaa', name: 'sports.jpg', mimeType: 'image/jpeg', size: String(jpeg.length) }, bytes: jpeg },
    pdf1aaaaaaaaaaaa: { meta: { id: 'pdf1aaaaaaaaaaaa', name: 'notes.pdf', mimeType: 'application/pdf', size: '10' }, bytes: Buffer.from('%PDF') },
    gdocaaaaaaaaaaaa: { meta: { id: 'gdocaaaaaaaaaaaa', name: 'Doc', mimeType: 'application/vnd.google-apps.document', size: '9' }, bytes: Buffer.alloc(0) },
    img2aaaaaaaaaaaa: { meta: { id: 'img2aaaaaaaaaaaa', name: 'trip.png', mimeType: 'image/png', size: String(png.length) }, bytes: png },
    hugeaaaaaaaaaaaa: { meta: { id: 'hugeaaaaaaaaaaaa', name: 'huge.jpg', mimeType: 'image/jpeg', size: String(10_485_760 + 1) }, bytes: Buffer.alloc(0) },
  });

  const result = await service.importFromDrive({
    url: 'https://drive.google.com/drive/folders/1AbCdeFghIjkLmnoPqrStu?usp=sharing',
    metadata: { caption: 'From our trip' },
  });

  if (result.failed.length > 0) console.log('FAILED ENTRIES:', JSON.stringify(result.failed));
  if (result.uploaded.length !== 2) console.log('DEBUG RESULT:', JSON.stringify({ total: result.total, uploaded: result.uploaded.length }));

  assert.equal(result.total, 2, 'non-images and oversized files are filtered out');
  assert.equal(result.uploaded.length, 2);
  assert.equal(result.failed.length, 0);
  assert.equal(result.uploaded[0].caption, 'From our trip');
  assert.equal(result.uploaded[0].exifStripped, true);
});

test('drive import handles a single-file link', async () => {
  const jpeg = await makeJpeg(30, 20);
  const service = serviceWith({
    img1aaaaaaaaaaaa: { meta: { id: 'img1aaaaaaaaaaaa', name: 'one.jpg', mimeType: 'image/jpeg', size: String(jpeg.length) }, bytes: jpeg },
  });

  const result = await service.importFromDrive({ url: 'https://drive.google.com/file/d/img1aaaaaaaaaaaa/view' });
  assert.equal(result.uploaded.length, 1);
  assert.equal(result.uploaded[0].filename, 'one.jpg');
});

test('drive import reports per-file failures without aborting the batch', async () => {
  const jpeg = await makeJpeg(30, 20);
  const service = serviceWith({
    goodaaaaaaaaaaaa: { meta: { id: 'goodaaaaaaaaaaaa', name: 'good.jpg', mimeType: 'image/jpeg', size: String(jpeg.length) }, bytes: jpeg },
    corruptaaaaaaaaaaaa: { meta: { id: 'corruptaaaaaaaaaaaa', name: 'corrupt.jpg', mimeType: 'image/jpeg', size: '10' }, bytes: Buffer.from('not an image') },
  });

  const result = await service.importFromDrive({ url: 'https://drive.google.com/drive/folders/1AbCdeFghIjkLmnoPqrStu' });
  assert.equal(result.uploaded.length, 1);
  assert.equal(result.failed.length, 1);
  assert.match(result.failed[0].message, /not a readable image/i);
});

test('invalid link and unconfigured service produce actionable errors', async () => {
  const noKeyService = createDriveImportService({
    config: makeTestConfig(),
    uploadService: createUploadService({ storage: fakeStorage(), repository: fakeRepository() }),
  });
  await assert.rejects(
    () => noKeyService.importFromDrive({ url: 'https://drive.google.com/drive/folders/1AbCdeFghIjkLmnoPqrStu' }),
    (err) => err.code === 'DRIVE_NOT_CONFIGURED' && err.status === 503,
  );

  const service = serviceWith({});
  await assert.rejects(
    () => service.importFromDrive({ url: 'https://example.com/nope' }),
    (err) => err.code === 'INVALID_DRIVE_LINK' && err.status === 400,
  );
});

// ---- Route tests ----

test('POST /api/drive/import requires admin', async () => {
  const app = await makeTestApp(KEY, { driveFetchImpl: fakeDriveFetch({}) });
  const res = await request(app).post('/api/drive/import').send({ url: 'https://drive.google.com/drive/folders/x' });
  assert.equal(res.status, 401);
});

test('POST /api/drive/import returns actionable 503 without the API key', async () => {
  const app = await makeTestApp({}, { extraRouters: [testLoginRouter()] });
  const agent = request.agent(app);
  await agent.post('/test/login').expect(200);
  const res = await agent.post('/api/drive/import').send({ url: 'https://drive.google.com/drive/folders/x' });
  assert.equal(res.status, 503);
  assert.equal(res.body.error.code, 'DRIVE_NOT_CONFIGURED');
  assert.match(res.body.error.message, /GOOGLE_DRIVE_API_KEY/);
});

test('POST /api/drive/import rejects invalid links with 400', async () => {
  const app = await makeTestApp(KEY, { extraRouters: [testLoginRouter()], driveFetchImpl: fakeDriveFetch({}) });
  const agent = request.agent(app);
  await agent.post('/test/login').expect(200);
  const res = await agent.post('/api/drive/import').send({ url: 'https://example.com/nope' });
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'INVALID_DRIVE_LINK');
});

test('POST /api/drive/import end to end through the fake Drive API', async () => {
  const jpeg = await makeJpeg(30, 20);
  const app = await makeTestApp(KEY, {
    extraRouters: [testLoginRouter()],
    driveFetchImpl: fakeDriveFetch({
      img1aaaaaaaaaaaa: { meta: { id: 'img1aaaaaaaaaaaa', name: 'beach.jpg', mimeType: 'image/jpeg', size: String(jpeg.length) }, bytes: jpeg },
    }),
  });
  const agent = request.agent(app);
  await agent.post('/test/login').expect(200);
  const res = await agent
    .post('/api/drive/import')
    .send({ url: 'https://drive.google.com/drive/folders/1AbCdeFghIjkLmnoPqrStu', collections: 'drive' });
  assert.equal(res.status, 200);
  assert.equal(res.body.uploaded.length, 1);
  assert.equal(res.body.total, 1);
  assert.deepEqual(res.body.uploaded[0].collections, ['drive']);
});
