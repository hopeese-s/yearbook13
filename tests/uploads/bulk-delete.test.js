import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import request from 'supertest';
import { makeTestApp, testLoginRouter } from '../helpers.js';

async function makeJpeg(width = 40, height = 40) {
  return sharp({ create: { width, height, channels: 3, background: 'blue' } }).jpeg().toBuffer();
}

async function uploadApp() {
  return makeTestApp({}, { extraRouters: [testLoginRouter()] });
}

async function loginAdmin(app) {
  const agent = request.agent(app);
  await agent.post('/test/login').expect(200);
  return agent;
}

test('POST /api/photos/bulk-delete requires admin authentication', async () => {
  const app = await uploadApp();
  const res = await request(app).post('/api/photos/bulk-delete').send({ ids: ['p-1', 'p-2'] });
  assert.equal(res.status, 401);
});

test('POST /api/photos/bulk-delete rejects missing or invalid ids array', async () => {
  const app = await uploadApp();
  const agent = await loginAdmin(app);

  const res1 = await agent.post('/api/photos/bulk-delete').send({});
  assert.equal(res1.status, 400);

  const res2 = await agent.post('/api/photos/bulk-delete').send({ ids: [] });
  assert.equal(res2.status, 400);

  const res3 = await agent.post('/api/photos/bulk-delete').send({ ids: 'invalid' });
  assert.equal(res3.status, 400);
});

test('POST /api/photos/bulk-delete removes multiple records and storage objects in one request', async () => {
  const app = await uploadApp();
  const agent = await loginAdmin(app);

  // Upload 3 photos
  const upload1 = await agent.post('/api/photos').attach('photos', await makeJpeg(), { filename: 'p1.jpg', contentType: 'image/jpeg' });
  const upload2 = await agent.post('/api/photos').attach('photos', await makeJpeg(), { filename: 'p2.jpg', contentType: 'image/jpeg' });
  const upload3 = await agent.post('/api/photos').attach('photos', await makeJpeg(), { filename: 'p3.jpg', contentType: 'image/jpeg' });

  const p1 = upload1.body.uploaded[0];
  const p2 = upload2.body.uploaded[0];
  const p3 = upload3.body.uploaded[0];

  const listBefore = await request(app).get('/api/photos');
  assert.equal(listBefore.body.total, 3);

  // Bulk delete p1 and p2
  const deleteRes = await agent.post('/api/photos/bulk-delete').send({ ids: [p1.id, p2.id] });
  assert.equal(deleteRes.status, 200);
  assert.equal(deleteRes.body.ok, true);
  assert.equal(deleteRes.body.count, 2);
  assert.deepEqual(deleteRes.body.deleted, [p1.id, p2.id]);

  // Verify list only has p3 now
  const listAfter = await request(app).get('/api/photos');
  assert.equal(listAfter.body.total, 1);
  assert.equal(listAfter.body.items[0].id, p3.id);

  // Verify p1 and p2 stored files are gone
  const p1File = await request(app).get(p1.fileUrl);
  assert.equal(p1File.status, 404);
  const p2File = await request(app).get(p2.fileUrl);
  assert.equal(p2File.status, 404);

  // Verify p3 file is intact
  const p3File = await request(app).get(p3.fileUrl);
  assert.equal(p3File.status, 200);
});
