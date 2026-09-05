import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import request from 'supertest';
import { makeTestApp, testLoginRouter } from '../helpers.js';
import { createUploadService } from '../../src/uploads/upload.service.js';

async function makeJpeg(width = 600, height = 400) {
  return sharp({ create: { width, height, channels: 3, background: 'orange' } }).jpeg().toBuffer();
}

async function uploadApp(overrides = {}) {
  return makeTestApp(overrides, { extraRouters: [testLoginRouter()] });
}

async function loginAdmin(app) {
  const agent = request.agent(app);
  await agent.post('/test/login').expect(200);
  return agent;
}

test('admin can upload a photo end to end: record + stored objects + public URLs', async () => {
  const app = await uploadApp();
  const agent = await loginAdmin(app);
  const jpeg = await makeJpeg();

  const res = await agent
    .post('/api/photos')
    .field('caption', 'Sports day')
    .field('tags', 'fun,sports')
    .attach('photos', jpeg, { filename: 'photo-1.jpg', contentType: 'image/jpeg' });

  assert.equal(res.status, 201);
  assert.equal(res.body.uploaded.length, 1);
  assert.equal(res.body.failed.length, 0);
  const photo = res.body.uploaded[0];
  assert.equal(photo.caption, 'Sports day');
  assert.deepEqual(photo.tags, ['fun', 'sports']);
  assert.equal(photo.exifStripped, true);
  assert.match(photo.fileUrl, /^\/api\/photos\/.+\/file$/);
  assert.match(photo.thumbUrl, /^\/api\/photos\/.+\/thumb$/);

  // Record is publicly listable
  const list = await request(app).get('/api/photos');
  assert.equal(list.status, 200);
  assert.equal(list.body.total, 1);

  // Stored objects are actually retrievable through the API
  const fileRes = await request(app).get(photo.fileUrl);
  assert.equal(fileRes.status, 200);
  assert.ok(fileRes.body.length > 0);
  const thumbRes = await request(app).get(photo.thumbUrl);
  assert.equal(thumbRes.status, 200);
  assert.ok(thumbRes.body.length > 0);
});

test('upload requires admin: anonymous 401, viewer 403', async () => {
  const app = await uploadApp();
  const jpeg = await makeJpeg(20, 20);

  const anonymous = await request(app)
    .post('/api/photos')
    .attach('photos', jpeg, { filename: 'x.jpg', contentType: 'image/jpeg' });
  assert.equal(anonymous.status, 401);

  const viewerRouter = testLoginRouter({ email: 'viewer@example.com', role: 'viewer' });
  const viewerApp = await makeTestApp({}, { extraRouters: [viewerRouter] });
  const viewerAgent = request.agent(viewerApp);
  await viewerAgent.post('/test/login').expect(200);
  const forbidden = await viewerAgent
    .post('/api/photos')
    .attach('photos', await makeJpeg(20, 20), { filename: 'x.jpg', contentType: 'image/jpeg' });
  assert.equal(forbidden.status, 403);
  assert.equal(forbidden.body.error.code, 'FORBIDDEN');
});

test('unsupported MIME types are rejected with 415', async () => {
  const app = await uploadApp();
  const agent = await loginAdmin(app);
  const res = await agent
    .post('/api/photos')
    .attach('photos', Buffer.from('plain text'), { filename: 'note.txt', contentType: 'text/plain' });
  assert.equal(res.status, 415);
});

test('oversized uploads are rejected with 413', async () => {
  const app = await uploadApp({ MAX_UPLOAD_BYTES: '1024' });
  const agent = await loginAdmin(app);
  const big = await makeJpeg(2000, 2000); // way more than 1KB
  const res = await agent
    .post('/api/photos')
    .attach('photos', big, { filename: 'big.jpg', contentType: 'image/jpeg' });
  assert.equal(res.status, 413);
});

test('upload endpoint is rate limited', async () => {
  const app = await uploadApp({ UPLOAD_RATE_LIMIT_MAX: '2' });
  const agent = await loginAdmin(app);
  for (let i = 0; i < 2; i += 1) {
    await agent
      .post('/api/photos')
      .attach('photos', await makeJpeg(20, 20), { filename: `p${i}.jpg`, contentType: 'image/jpeg' });
  }
  const limited = await agent
    .post('/api/photos')
    .attach('photos', await makeJpeg(20, 20), { filename: 'p3.jpg', contentType: 'image/jpeg' });
  assert.equal(limited.status, 429);
  assert.equal(limited.body.error.code, 'RATE_LIMITED');
});

test('failed metadata persistence cleans up stored objects (no orphans)', async () => {
  const savedKeys = [];
  const deletedKeys = [];
  const storage = {
    name: 'fake',
    save: async (key, buffer) => {
      savedKeys.push(key);
      return { key, size: buffer.length };
    },
    read: async () => Buffer.alloc(0),
    delete: async (key) => {
      deletedKeys.push(key);
    },
    exists: async () => true,
    stat: async (key) => ({ key, size: 1 }),
    publicUrl: () => null,
  };
  const repository = {
    createPhoto: async () => {
      throw new Error('simulated metadata failure');
    },
    deletePhoto: async () => true,
  };

  const service = createUploadService({ storage, repository });
  await assert.rejects(
    async () =>
      service.uploadPhoto({
        buffer: await makeJpeg(30, 30),
        originalName: 'cleanup.jpg',
        metadata: { caption: 'x' },
      }),
    (err) => err.message.includes('simulated metadata failure'),
  );
  assert.equal(savedKeys.length, 2, 'both objects were stored before failure');
  assert.deepEqual([...deletedKeys].sort(), [...savedKeys].sort(), 'cleanup removed exactly what was stored');
});

test('failed storage deletes on photo removal are logged, never silent', async () => {
  const storage = {
    name: 'fake',
    save: async (key) => ({ key, size: 1 }),
    read: async () => Buffer.alloc(0),
    delete: async (key) => {
      if (key.includes('thumb')) throw new Error('R2 network error');
    },
    exists: async () => true,
    stat: async (key) => ({ key, size: 1 }),
    publicUrl: () => null,
  };
  const repository = {
    createPhoto: async () => {},
    deletePhoto: async () => true,
  };
  const service = createUploadService({ storage, repository });

  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args.map(String).join(' '));
  try {
    await service.deletePhoto({ id: 'ph-x', storageKey: 'photos/full/ph-x.jpg', thumbKey: 'photos/thumb/ph-x.jpg' });
  } finally {
    console.warn = originalWarn;
  }
  assert.ok(
    warnings.some((line) => line.includes('ORPHANED_OBJECT') && line.includes('photos/thumb/ph-x.jpg')),
    'orphaned object key must be logged with a warning',
  );
});

test('admin can edit metadata and delete a photo (record + objects)', async () => {
  const app = await uploadApp();
  const agent = await loginAdmin(app);
  const created = await agent
    .post('/api/photos')
    .attach('photos', await makeJpeg(30, 30), { filename: 'edit.jpg', contentType: 'image/jpeg' });
  const photo = created.body.uploaded[0];

  const patched = await agent.patch(`/api/photos/${photo.id}`).send({ caption: 'updated caption' });
  assert.equal(patched.status, 200);
  assert.equal(patched.body.photo.caption, 'updated caption');

  const removed = await agent.delete(`/api/photos/${photo.id}`);
  assert.equal(removed.status, 200);
  const afterDelete = await request(app).get(`/api/photos/${photo.id}`);
  assert.equal(afterDelete.status, 404);
  const fileAfterDelete = await request(app).get(photo.fileUrl);
  assert.equal(fileAfterDelete.status, 404, 'stored object must be gone after delete');
});

test('admin can upload a video file and retrieve it with correct MIME type and poster thumbnail', async () => {
  const app = await uploadApp();
  const agent = await loginAdmin(app);
  const fakeVideoBuffer = Buffer.from('fake mp4 video binary content');

  const res = await agent
    .post('/api/photos')
    .field('caption', 'Class performance clip')
    .field('collections', 'Concert,Highlights')
    .attach('photos', fakeVideoBuffer, { filename: 'clip.mp4', contentType: 'video/mp4' });

  assert.equal(res.status, 201);
  assert.equal(res.body.uploaded.length, 1);
  const video = res.body.uploaded[0];
  assert.equal(video.caption, 'Class performance clip');
  assert.equal(video.mediaType, 'video');
  assert.deepEqual(video.collections, ['Concert', 'Highlights']);

  // Verify file serving sets video/mp4 MIME type
  const fileRes = await request(app).get(video.fileUrl);
  assert.equal(fileRes.status, 200);
  assert.equal(fileRes.headers['content-type'], 'video/mp4');

  // Verify thumbnail exists
  const thumbRes = await request(app).get(video.thumbUrl);
  assert.equal(thumbRes.status, 200);
  assert.ok(thumbRes.body.length > 0);
});
