import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildZip, crc32 } from '../../src/util/zip.js';

test('crc32 produces correct checksums', () => {
  const buf = Buffer.from('123456789');
  assert.equal(crc32(buf), 0xcbf43926);
});

test('buildZip builds a valid ZIP archive containing multiple entries', () => {
  const entries = [
    { name: 'hello.txt', data: Buffer.from('Hello World') },
    { name: 'photos/grad.jpg', data: Buffer.from('fake-jpeg-bytes') },
  ];
  const zipBuffer = buildZip(entries);
  assert.ok(zipBuffer.length > 100);

  // Check Local File Header signatures (0x04034b50 -> Buffer [0x50, 0x4b, 0x03, 0x04])
  assert.equal(zipBuffer[0], 0x50);
  assert.equal(zipBuffer[1], 0x4b);
  assert.equal(zipBuffer[2], 0x03);
  assert.equal(zipBuffer[3], 0x04);

  // Check EOCD signature at the end (0x06054b50 -> Buffer [0x50, 0x4b, 0x05, 0x06])
  const eocdStart = zipBuffer.length - 22;
  assert.equal(zipBuffer[eocdStart], 0x50);
  assert.equal(zipBuffer[eocdStart + 1], 0x4b);
  assert.equal(zipBuffer[eocdStart + 2], 0x05);
  assert.equal(zipBuffer[eocdStart + 3], 0x06);
});
