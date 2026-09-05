import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createJsonRepository, SCHEMA_VERSION } from '../../src/data/json.repository.js';
import { validatePhotoInput, createPhotoRecord } from '../../src/domain/photos.js';

async function makeRepository() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ims13-repo-'));
  const file = path.join(dir, 'photos.json');
  return { repo: createJsonRepository({ file }), file, dir };
}

let counter = 0;
async function makeRecord(overrides = {}) {
  counter += 1;
  const { value } = validatePhotoInput({
    caption: `photo ${counter}`,
    tags: ['tag-a'],
    collections: ['collection-1'],
    categories: ['campus'],
    ...overrides.metadata,
  });
  return createPhotoRecord(value, {
    id: `ph-${counter}`,
    filename: `file-${counter}.jpg`,
    storageKey: `photos/full/ph-${counter}.jpg`,
    thumbKey: `photos/thumb/ph-${counter}.jpg`,
    width: 100,
    height: 80,
    thumbWidth: 48,
    thumbHeight: 38,
    createdAt: overrides.createdAt ?? new Date(Date.parse('2026-08-01T10:00:00.000Z') + counter * 1000).toISOString(),
  });
}

test('CRUD round trip through the JSON repository', async () => {
  const { repo } = await makeRepository();
  const record = await makeRecord();

  await repo.createPhoto(record);
  assert.equal(await repo.countPhotos(), 1);
  assert.deepEqual(await repo.getPhoto(record.id), record);

  const { value: patch } = validatePhotoInput({ caption: 'updated caption' });
  const updated = await repo.updatePhoto(record.id, { ...record, ...patch, updatedAt: '2026-08-02T00:00:00.000Z' });
  assert.equal(updated.caption, 'updated caption');

  assert.equal(await repo.deletePhoto(record.id), true);
  assert.equal(await repo.getPhoto(record.id), null);
  assert.equal(await repo.deletePhoto(record.id), false);
  assert.equal(await repo.countPhotos(), 0);
});

test('duplicate photo ids are rejected', async () => {
  const { repo } = await makeRepository();
  const record = await makeRecord();
  await repo.createPhoto(record);
  await assert.rejects(() => repo.createPhoto(record), (err) => err.code === 'DUPLICATE_ID');
});

test('listPhotos filters by collection, tag, category, section, year and person', async () => {
  const { repo } = await makeRepository();
  const a = await makeRecord({ metadata: { tags: ['graduation'], collections: ['2026'], categories: ['ceremony'], section: 'IMS13', personIds: ['p-1'] } });
  const b = await makeRecord({ metadata: { tags: ['sports'], collections: ['sports-day'], categories: ['events'], section: 'IMS12' } });
  await repo.createPhoto(a);
  await repo.createPhoto(b);

  assert.equal((await repo.listPhotos({ tag: 'GRADUATION' })).items.length, 1, 'tag filter is case-insensitive');
  assert.equal((await repo.listPhotos({ tag: 'graduation' })).items[0].id, a.id);
  assert.equal((await repo.listPhotos({ collection: 'sports-day' })).items[0].id, b.id);
  assert.equal((await repo.listPhotos({ category: 'ceremony' })).items[0].id, a.id);
  assert.equal((await repo.listPhotos({ section: 'ims13' })).items[0].id, a.id);
  assert.equal((await repo.listPhotos({ personId: 'p-1' })).items[0].id, a.id);
  assert.equal((await repo.listPhotos({ tag: 'nope' })).total, 0);
});

test('listPhotos sorts newest/oldest and paginates deterministically', async () => {
  const { repo } = await makeRepository();
  const created = [];
  for (let i = 0; i < 5; i += 1) {
    const record = await makeRecord();
    created.push(record);
    await repo.createPhoto(record);
  }

  const newest = await repo.listPhotos({ sort: 'newest', limit: 3 });
  assert.equal(newest.total, 5);
  assert.equal(newest.limit, 3);
  const times = newest.items.map((r) => r.createdAt);
  assert.deepEqual(times, [...times].sort().reverse());

  const byOldest = [...created].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const oldest = await repo.listPhotos({ sort: 'oldest', limit: 2, offset: 1 });
  assert.deepEqual(oldest.items.map((r) => r.id), [byOldest[1].id, byOldest[2].id]);

  const largeLimit = await repo.listPhotos({ limit: 1000 });
  assert.equal(largeLimit.limit, 1000);
});

test('missing metadata file starts empty', async () => {
  const { repo } = await makeRepository();
  assert.equal(await repo.countPhotos(), 0);
});

test('malformed metadata file is quarantined and store restarts empty', async () => {
  const { repo, file } = await makeRepository();
  await fs.writeFile(file, '{definitely not json', 'utf8');

  await assert.rejects(() => repo.countPhotos(), (err) => err.code === 'METADATA_CORRUPT');
  assert.ok(await fs.access(`${file}.corrupt`).then(() => true, () => false), 'corrupt file quarantined');
  // After quarantine the store behaves as empty (recovery path).
  assert.equal(await repo.countPhotos(), 0);
});

test('records on disk are migrated to the current schema on load', async () => {
  const { repo, file } = await makeRepository();
  await fs.writeFile(
    file,
    JSON.stringify([{ id: 'legacy-1', filename: 'old.jpg', storageKey: 'k', thumbKey: 't' }]),
    'utf8',
  );
  assert.equal(await repo.countPhotos(), 1);
  const legacy = await repo.getPhoto('legacy-1');
  assert.equal(legacy.schemaVersion, SCHEMA_VERSION);
  assert.deepEqual(legacy.tags, []);
  assert.equal(legacy.caption, '');
});
