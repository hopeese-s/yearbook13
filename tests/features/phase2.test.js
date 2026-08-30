import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import sharp from 'sharp';
import { makeTestApp, testLoginRouter } from '../helpers.js';

async function makeJpeg() {
  return sharp({ create: { width: 30, height: 20, channels: 3, background: 'blue' } }).jpeg().toBuffer();
}

test('GET /api/photos/export/zip downloads a valid ZIP archive of stored photos', async () => {
  const app = await makeTestApp({}, { extraRouters: [testLoginRouter()] });
  const agent = request.agent(app);
  await agent.post('/test/login').expect(200);

  const jpeg = await makeJpeg();
  await agent
    .post('/api/photos')
    .attach('photos', jpeg, 'sample.jpg')
    .field('caption', 'Zip test photo')
    .expect(201);

  const zipRes = await agent
    .get('/api/photos/export/zip')
    .buffer(true)
    .parse((res, cb) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });

  assert.equal(zipRes.status, 200);
  assert.match(zipRes.headers['content-type'], /zip/);
  assert.match(zipRes.headers['content-disposition'], /ims13-yearbook-backup\.zip/);
  assert.ok(zipRes.body.length > 50);
});

test('POST /api/photos/bulk updates multiple records at once', async () => {
  const app = await makeTestApp({}, { extraRouters: [testLoginRouter()] });
  const agent = request.agent(app);
  await agent.post('/test/login').expect(200);

  const jpeg = await makeJpeg();
  const up1 = await agent.post('/api/photos').attach('photos', jpeg, 'one.jpg').expect(201);
  const up2 = await agent.post('/api/photos').attach('photos', jpeg, 'two.jpg').expect(201);

  const id1 = up1.body.uploaded[0].id;
  const id2 = up2.body.uploaded[0].id;

  const bulkRes = await agent
    .post('/api/photos/bulk')
    .send({ ids: [id1, id2], patch: { collections: ['reunion'], personIds: ['alex', 'sarah'] } });

  assert.equal(bulkRes.status, 200);
  assert.equal(bulkRes.body.updated.length, 2);
  assert.deepEqual(bulkRes.body.updated[0].collections, ['reunion']);
  assert.deepEqual(bulkRes.body.updated[0].personIds, ['alex', 'sarah']);
});

test('GET /api/photos?search=... performs multi-field search', async () => {
  const app = await makeTestApp({}, { extraRouters: [testLoginRouter()] });
  const agent = request.agent(app);
  await agent.post('/test/login').expect(200);

  const jpeg = await makeJpeg();
  await agent.post('/api/photos').attach('photos', jpeg, 'match1.jpg').field('caption', 'Graduation ceremony').expect(201);
  await agent.post('/api/photos').attach('photos', jpeg, 'match2.jpg').field('personIds', 'jordan').expect(201);
  await agent.post('/api/photos').attach('photos', jpeg, 'other.jpg').field('caption', 'Random day').expect(201);

  const searchGrad = await request(app).get('/api/photos?search=graduation');
  assert.equal(searchGrad.body.items.length, 1);

  const searchJordan = await request(app).get('/api/photos?search=jordan');
  assert.equal(searchJordan.body.items.length, 1);
  assert.deepEqual(searchJordan.body.items[0].personIds, ['jordan']);
});
