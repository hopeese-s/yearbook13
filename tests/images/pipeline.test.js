import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { processImage, ALLOWED_FORMATS, THUMB_WIDTH, ImageError } from '../../src/images/pipeline.js';

async function makePng(width, height, color = 'red') {
  return sharp({ create: { width, height, channels: 3, background: color } }).png().toBuffer();
}

test('valid image passes the pipeline: oriented, EXIF-free, thumbnailed', async () => {
  const input = await makePng(1000, 600, 'blue');
  const result = await processImage(input);

  assert.ok(ALLOWED_FORMATS.has(result.format));
  assert.equal(result.full.width, 1000);
  assert.equal(result.full.height, 600);
  assert.ok(result.thumb.width <= THUMB_WIDTH);
  assert.equal(result.thumb.width, THUMB_WIDTH);
  assert.equal(result.thumb.height, Math.round((600 * THUMB_WIDTH) / 1000));

  const fullMeta = await sharp(result.full.buffer).metadata();
  assert.equal(fullMeta.exif, undefined, 'full output must not retain EXIF');
});

test('EXIF orientation is normalized (dimensions swap) and metadata stripped', async () => {
  // 40x20 with EXIF Orientation=6 (rotated 90 deg) must come out 20x40 upright.
  const input = await sharp({ create: { width: 40, height: 20, channels: 3, background: 'green' } })
    .png()
    .withMetadata({ orientation: 6 })
    .toBuffer();

  const before = await sharp(input).metadata();
  assert.equal(before.width, 40, 'source is landscape pre-orientation');

  const result = await processImage(input);
  assert.equal(result.full.width, 20, 'orientation applied: width swapped');
  assert.equal(result.full.height, 40, 'orientation applied: height swapped');
});

test('non-image bytes are rejected as unsupported', async () => {
  await assert.rejects(
    () => processImage(Buffer.from('this is not an image at all')),
    (err) => {
      assert.ok(err instanceof ImageError);
      assert.equal(err.code, 'UNSUPPORTED_MEDIA_TYPE');
      assert.equal(err.status, 415);
      return true;
    },
  );
});

test('oversized files are rejected before any processing', async () => {
  const input = await makePng(50, 50);
  await assert.rejects(
    () => processImage(input, { maxUploadBytes: 16 }),
    (err) => {
      assert.equal(err.code, 'PAYLOAD_TOO_LARGE');
      assert.equal(err.status, 413);
      return true;
    },
  );
});

test('empty buffers are rejected', async () => {
  await assert.rejects(() => processImage(Buffer.alloc(0)), (err) => err.code === 'INVALID_FILE');
  await assert.rejects(() => processImage('not-a-buffer'), (err) => err.code === 'INVALID_FILE');
});
