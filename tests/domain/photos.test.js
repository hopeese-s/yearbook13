import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validatePhotoInput,
  createPhotoRecord,
  applyPhotoPatch,
  CAPTION_MAX_LENGTH,
} from '../../src/domain/photos.js';

test('valid input normalizes labels and defaults', () => {
  const { value, errors } = validatePhotoInput({
    caption: '  Sports day  ',
    section: ' Class A ',
    year: '2026',
    collections: ['Sports', 'sports', '  Field  '],
    tags: ['Fun', 'fun', 'SUN'],
    categories: ['Events'],
    personIds: ['p1'],
  });
  assert.deepEqual(errors, []);
  assert.equal(value.caption, 'Sports day');
  assert.equal(value.section, 'Class A');
  assert.equal(value.year, 2026);
  assert.deepEqual(value.collections, ['Sports', 'Field']);
  assert.deepEqual(value.tags, ['Fun', 'SUN']);
  assert.deepEqual(value.categories, ['Events']);
  assert.deepEqual(value.personIds, ['p1']);
});

test('empty input yields an empty-but-valid metadata set', () => {
  const { value, errors } = validatePhotoInput({});
  assert.deepEqual(errors, []);
  assert.deepEqual(value, {
    caption: '',
    section: '',
    year: null,
    personIds: [],
    collections: [],
    tags: [],
    categories: [],
  });
});

test('invalid input reports every problem at once', () => {
  const { value, errors } = validatePhotoInput({
    caption: 'x'.repeat(CAPTION_MAX_LENGTH + 1),
    year: '1899',
    tags: [42],
    collections: ['ok', ''],
  });
  assert.equal(value, undefined);
  assert.ok(errors.some((e) => e.includes('caption')));
  assert.ok(errors.some((e) => e.includes('year')));
  assert.ok(errors.some((e) => e.includes('tags')));
  assert.ok(!errors.some((e) => e.includes('collections')));
});

test('createPhotoRecord freezes the full persisted shape', () => {
  const { value } = validatePhotoInput({ caption: 'graduation', tags: ['march'] });
  const now = '2026-08-29T12:00:00.000Z';
  const record = createPhotoRecord(value, {
    id: 'ph-1',
    filename: 'grad.jpg',
    storageKey: 'photos/full/ph-1.jpg',
    thumbKey: 'photos/thumb/ph-1.jpg',
    width: 4000,
    height: 3000,
    thumbWidth: 480,
    thumbHeight: 360,
    createdAt: now,
  });
  assert.equal(record.exifStripped, true);
  assert.equal(record.schemaVersion, 1);
  assert.equal(record.updatedAt, now);
  assert.ok(Object.isFrozen(record));
});

test('applyPhotoPatch whitelists metadata only and refreshes updatedAt', () => {
  const { value } = validatePhotoInput({ caption: 'before', tags: ['old'] });
  const now = '2026-08-29T12:00:00.000Z';
  const record = createPhotoRecord(value, {
    id: 'ph-2',
    filename: 'a.jpg',
    storageKey: 'photos/full/ph-2.jpg',
    thumbKey: 'photos/thumb/ph-2.jpg',
    width: 100,
    height: 100,
    thumbWidth: 48,
    thumbHeight: 48,
    createdAt: now,
  });

  const patched = applyPhotoPatch(record, { caption: 'after', storageKey: 'hack-attempt.jpg', id: 'new-id' });
  assert.deepEqual(patched.errors, []);
  assert.equal(patched.value.caption, 'after');
  assert.equal(patched.value.storageKey, 'photos/full/ph-2.jpg');
  assert.equal(patched.value.id, 'ph-2');
  assert.notEqual(patched.value.updatedAt, now);
  assert.ok(!Number.isNaN(Date.parse(patched.value.updatedAt)), 'updatedAt must remain a valid ISO timestamp');
});

test('applyPhotoPatch rejects invalid metadata', () => {
  const { value } = validatePhotoInput({});
  const record = createPhotoRecord(value, {
    id: 'ph-3',
    filename: 'b.jpg',
    storageKey: 'k',
    thumbKey: 't',
    width: 1,
    height: 1,
    thumbWidth: 1,
    thumbHeight: 1,
    createdAt: '2026-08-29T12:00:00.000Z',
  });
  const { value: noValue, errors } = applyPhotoPatch(record, { year: 12345 });
  assert.equal(noValue, undefined);
  assert.ok(errors.some((e) => e.includes('year')));
});
