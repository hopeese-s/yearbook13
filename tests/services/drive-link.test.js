import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDriveLink } from '../../src/services/drive-link.js';

test('parses folder link shapes', () => {
  for (const url of [
    'https://drive.google.com/drive/folders/1AbCdeFghIjkLmnoPqrStu?usp=sharing',
    'https://drive.google.com/drive/u/0/folders/1AbCdeFghIjkLmnoPqrStu',
    'https://drive.google.com/drive/mobile/folders/1AbCdeFghIjkLmnoPqrStu',
  ]) {
    const parsed = parseDriveLink(url);
    assert.deepEqual(parsed, { kind: 'folder', id: '1AbCdeFghIjkLmnoPqrStu' }, url);
  }
});

test('parses file link shapes', () => {
  for (const url of [
    'https://drive.google.com/file/d/1AbCdeFghIjkLmnoPqrStu/view?usp=sharing',
    'https://drive.google.com/open?id=1AbCdeFghIjkLmnoPqrStu',
    'https://drive.google.com/uc?id=1AbCdeFghIjkLmnoPqrStu&export=download',
    'https://docs.google.com/leaf?id=1AbCdeFghIjkLmnoPqrStu',
  ]) {
    const parsed = parseDriveLink(url);
    assert.deepEqual(parsed, { kind: 'file', id: '1AbCdeFghIjkLmnoPqrStu' }, url);
  }
});

test('a bare resource ID is treated as a folder', () => {
  assert.deepEqual(parseDriveLink('1AbCdeFghIjkLmnoPqrStuVwx'), { kind: 'folder', id: '1AbCdeFghIjkLmnoPqrStuVwx' });
});

test('rejects non-Drive links and junk', () => {
  for (const bad of [
    'https://photos.google.com/whatever',
    'https://example.com/drive/folders/1AbCdeFghIjkLmnoPqrStu',
    'not a link',
    '',
    null,
    42,
  ]) {
    assert.equal(parseDriveLink(bad), null, String(bad));
  }
});
