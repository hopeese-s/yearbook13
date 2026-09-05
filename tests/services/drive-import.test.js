import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import sharp from 'sharp';
import request from 'supertest';
import { createDriveImportService } from '../../src/services/drive-import.js';
import { createUploadService } from '../../src/uploads/upload.service.js';
import { makeTestApp, makeTestConfig, testLoginRouter } from '../helpers.js';

const KEY = { GOOGLE_DRIVE_API_KEY: 'test-drive-key' };

/** Generates a throwaway RSA keypair and the matching SA JSON key. */
function makeServiceAccount() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  return {
    json: JSON.stringify({
      client_email: 'yearbook-import@ims13.iam.gserviceaccount.com',
      private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    }),
    email: 'yearbook-import@ims13.iam.gserviceaccount.com',
    publicPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  };
}

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
    hugeaaaaaaaaaaaa: { meta: { id: 'hugeaaaaaaaaaaaa', name: 'huge.jpg', mimeType: 'image/jpeg', size: String(300_000_000) }, bytes: Buffer.alloc(0) },
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

test('drive import handles a single-file video link (MP4)', async () => {
  const videoBuffer = Buffer.from('fake mp4 video bytes');
  const service = serviceWith({
    vid1aaaaaaaaaaaa: { meta: { id: 'vid1aaaaaaaaaaaa', name: 'clip.mp4', mimeType: 'video/mp4', size: String(videoBuffer.length) }, bytes: videoBuffer },
  });

  const result = await service.importFromDrive({ url: 'https://drive.google.com/file/d/vid1aaaaaaaaaaaa/view' });
  assert.equal(result.uploaded.length, 1);
  assert.equal(result.uploaded[0].filename, 'clip.mp4');
  assert.equal(result.uploaded[0].mediaType, 'video');
  assert.equal(result.uploaded[0].embedUrl, 'https://drive.google.com/file/d/vid1aaaaaaaaaaaa/preview');
});

test('drive import streams large videos without size limit (Approach 2)', async () => {
  const service = serviceWith({
    vid_hugeaaaaaaaa: {
      meta: {
        id: 'vid_hugeaaaaaaaa',
        name: 'DSC_1997.MP4',
        mimeType: 'video/mp4',
        size: '319291392', // ~304.5 MB
        thumbnailLink: 'https://lh3.googleusercontent.com/u/0/d/vid_huge=s220',
      },
      bytes: Buffer.alloc(0),
    },
  });

  const result = await service.importFromDrive({ url: 'https://drive.google.com/file/d/vid_hugeaaaaaaaa/view' });
  assert.equal(result.uploaded.length, 1);
  assert.equal(result.uploaded[0].filename, 'DSC_1997.MP4');
  assert.equal(result.uploaded[0].mediaType, 'video');
  assert.equal(result.uploaded[0].embedUrl, 'https://drive.google.com/file/d/vid_hugeaaaaaaaa/preview');
  assert.equal(result.uploaded[0].driveFileId, 'vid_hugeaaaaaaaa');
  assert.match(result.uploaded[0].externalThumbUrl, /lh3\.googleusercontent\.com/);
});

test('drive import rejects single oversized image with 413 and clear message', async () => {
  const service = serviceWith({
    huge1aaaaaaaaaaa: {
      meta: { id: 'huge1aaaaaaaaaaa', name: 'huge_photo.jpg', mimeType: 'image/jpeg', size: String(300_000_000) },
      bytes: Buffer.alloc(0),
    },
  });

  await assert.rejects(
    () => service.importFromDrive({ url: 'https://drive.google.com/file/d/huge1aaaaaaaaaaa/view' }),
    (err) => {
      assert.equal(err.status, 413);
      assert.equal(err.code, 'PAYLOAD_TOO_LARGE');
      assert.match(err.message, /huge_photo\.jpg/);
      assert.match(err.message, /exceeds maximum upload limit/);
      return true;
    },
  );
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

test('GET /api/drive/config returns mode and serviceAccountEmail to admin', async () => {
  const app = await makeTestApp(KEY, { extraRouters: [testLoginRouter()] });
  const agent = request.agent(app);
  await agent.post('/test/login').expect(200);

  const res = await agent.get('/api/drive/config');
  assert.equal(res.status, 200);
  assert.equal(res.body.mode, 'api-key');
  assert.equal(res.body.enabled, true);
  assert.equal(res.body.serviceAccountEmail, '');
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

// ---- Service account mode ----

test('service account mode signs a real JWT and calls Drive with a Bearer token', async () => {
  const sa = makeServiceAccount();
  const jpeg = await makeJpeg(30, 20);
  const captured = { publicPem: sa.publicPem };

  const fetchImpl = async (url, options = {}) => {
    if (url === 'https://oauth2.googleapis.com/token') {
      captured.assertion = new URLSearchParams(options.body).get('assertion');
      const [header, claims, signature] = captured.assertion.split('.');
      const signatureValid = crypto.verify(
        'RSA-SHA256',
        Buffer.from(`${header}.${claims}`),
        sa.publicPem,
        Buffer.from(signature, 'base64url'),
      );
      captured.jwtSignatureValid = signatureValid;
      captured.claims = JSON.parse(Buffer.from(claims, 'base64url').toString());
      return { ok: true, json: async () => ({ access_token: 'sa-token-123', expires_in: 3600 }) };
    }
    const copy = Buffer.from(jpeg);
    if (url.includes('alt=media')) {
      captured.authHeader = options.headers?.Authorization;
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () => copy.buffer.slice(copy.byteOffset, copy.byteOffset + copy.byteLength),
      };
    }
    if (url.includes('/drive/v3/files')) {
      captured.authHeader = options.headers?.Authorization;
      return {
        ok: true,
        json: async () => ({ files: [{ id: 'sa1', name: 'shared.jpg', mimeType: 'image/jpeg', size: String(jpeg.length) }] }),
      };
    }
    return { ok: false, status: 400, json: async () => ({}) };
  };

  const service = createDriveImportService({
    config: makeTestConfig({ GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON: sa.json }),
    uploadService: createUploadService({ storage: fakeStorage(), repository: fakeRepository() }),
    fetchImpl,
  });

  const result = await service.importFromDrive({ url: 'https://drive.google.com/drive/folders/1AbCdeFghIjkLmnoPqrStu' });
  assert.equal(result.uploaded.length, 1);
  assert.equal(captured.jwtSignatureValid, true, 'JWT must be correctly RS256-signed');
  assert.equal(captured.claims.iss, sa.email);
  assert.equal(captured.claims.scope, 'https://www.googleapis.com/auth/drive.readonly');
  assert.equal(captured.authHeader, 'Bearer sa-token-123');
});

test('service account 404 error message names both sharing options', async () => {
  const sa = makeServiceAccount();
  const fetchImpl = async (url) => {
    if (url.includes('/drive/v3/files') && !url.includes('oauth2')) {
      return { ok: false, status: 404, json: async () => ({ error: { message: 'File not found' } }) };
    }
    return { ok: true, json: async () => ({ access_token: 'tok' }) };
  };

  const service = createDriveImportService({
    config: makeTestConfig({ GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON: sa.json }),
    uploadService: createUploadService({ storage: fakeStorage(), repository: fakeRepository() }),
    fetchImpl,
  });

  await assert.rejects(
    () => service.importFromDrive({ url: 'https://drive.google.com/drive/folders/1AbCdeFghIjkLmnoPqrStu' }),
    (err) => {
      assert.equal(err.code, 'DRIVE_API_ERROR');
      assert.match(err.message, /Anyone with the link/);
      assert.match(err.message, /yearbook-import@ims13\.iam\.gserviceaccount\.com/);
      return true;
    },
  );
});

test('GET /api/drive/config reports service-account mode when configured', async () => {
  const sa = makeServiceAccount();
  const app = await makeTestApp(
    { ...KEY, GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON: sa.json },
    { extraRouters: [testLoginRouter()] },
  );
  const agent = request.agent(app);
  await agent.post('/test/login').expect(200);

  const res = await agent.get('/api/drive/config');
  assert.equal(res.status, 200);
  assert.equal(res.body.mode, 'service-account');
  assert.equal(res.body.serviceAccountEmail, sa.email);
  assert.ok(!JSON.stringify(res.body).includes('PRIVATE KEY'), 'the key must never leave the server');
});

