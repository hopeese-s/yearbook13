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

test('zipStream streams a valid archive with data descriptors and skips unreadable entries', async () => {
  const { zipStream } = await import('../../src/util/zip.js');
  const a = Buffer.from('first-file-bytes');
  const b = Buffer.alloc(100_000, 3);
  async function* chunked(buf) {
    for (let i = 0; i < buf.length; i += 4096) yield buf.subarray(i, i + 4096);
  }
  const entries = [
    { name: 'a.txt', open: async () => chunked(a) },
    { name: 'missing.jpg', open: async () => { throw new Error('gone'); } },
    { name: 'dir/b.bin', open: async () => chunked(b) },
  ];
  const parts = [];
  for await (const part of zipStream(entries)) parts.push(part);
  const zip = Buffer.concat(parts);

  const eocd = zip.length - 22;
  assert.equal(zip.readUInt32LE(eocd), 0x06054b50);
  assert.equal(zip.readUInt16LE(eocd + 10), 2, 'two entries (missing one skipped)');

  // Walk the central directory and verify each entry's CRC + size + data.
  let pos = zip.readUInt32LE(eocd + 16);
  for (const [name, data] of [['a.txt', a], ['dir/b.bin', b]]) {
    assert.equal(zip.readUInt32LE(pos), 0x02014b50);
    const crc = zip.readUInt32LE(pos + 16);
    const size = zip.readUInt32LE(pos + 20);
    const nameLen = zip.readUInt16LE(pos + 28);
    const local = zip.readUInt32LE(pos + 42);
    assert.equal(zip.toString('utf8', pos + 46, pos + 46 + nameLen), name);
    assert.equal(crc, crc32(data));
    assert.equal(size, data.length);
    const dataStart = local + 30 + zip.readUInt16LE(local + 26);
    assert.ok(zip.subarray(dataStart, dataStart + size).equals(data));
    assert.equal(zip.readUInt32LE(dataStart + size), 0x08074b50, 'data descriptor follows the data');
    pos += 46 + nameLen;
  }
});

test('crc32 can be computed incrementally', () => {
  const whole = Buffer.from('123456789');
  assert.equal(crc32(whole.subarray(4), crc32(whole.subarray(0, 4))), 0xcbf43926);
});
