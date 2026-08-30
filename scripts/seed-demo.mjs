// Seed demo photos (synthetic placeholders, clearly labeled) so the gallery
// is not empty on first run. Dev convenience only — safe to delete.
// Usage: node scripts/seed-demo.mjs [count]
import 'dotenv/config';
import path from 'node:path';
import sharp from 'sharp';
import { loadEnv } from '../src/config/env.js';
import { paths } from '../src/config/paths.js';
import { createLocalStorage } from '../src/storage/local.driver.js';
import { createJsonRepository } from '../src/data/json.repository.js';
import { createUploadService } from '../src/uploads/upload.service.js';

const config = loadEnv();
const storage = createLocalStorage(config);
const repository = createJsonRepository({ file: path.join(paths.data(config), 'photos.json') });
const service = createUploadService({ storage, repository });

const PALETTES = [
  ['#3880ff', '#a860fa', '#ff5894'],
  ['#40e0d0', '#3880ff', '#12151f'],
  ['#ffd60a', '#ff8a3d', '#ff5f6b'],
  ['#a860fa', '#ff5894', '#ffd60a'],
  ['#32d583', '#40e0d0', '#0b0d14'],
  ['#ff5f6b', '#a860fa', '#3880ff'],
  ['#0a84ff', '#40e0d0', '#a860fa'],
  ['#ff8a3d', '#ffd60a', '#ff5f6b'],
];

const CAPTIONS = [
  'Sports day sprint', 'Class trip', 'Science fair', 'Graduation rehearsal',
  'Art project', 'Music night', 'Library study', 'Field day',
];

const count = Math.min(Number(process.argv[2] ?? 8), 24);

for (let index = 0; index < count; index += 1) {
  const [a, b, c] = PALETTES[index % PALETTES.length];
  const width = 1200;
  const height = 900;
  const jpeg = await sharp({
    create: { width, height, channels: 3, background: a },
  })
    .composite([
      { input: Buffer.from(`<svg width="${width}" height="${height}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${b}"/><stop offset="1" stop-color="${c}"/></linearGradient></defs><rect width="${width}" height="${height}" fill="url(#g)" opacity="0.85"/><circle cx="${width * 0.7}" cy="${height * 0.35}" r="${height * 0.28}" fill="#ffffff" opacity="0.14"/></svg>`), top: 0, left: 0 },
    ])
    .jpeg({ quality: 82 })
    .toBuffer();

  const record = await service.uploadPhoto({
    buffer: jpeg,
    originalName: `ims13-demo-${index + 1}.jpg`,
    metadata: {
      caption: `${CAPTIONS[index % CAPTIONS.length]} (sample)`,
      section: 'IMS13',
      year: 2026,
      collections: [index % 2 === 0 ? 'campus' : 'events'],
      tags: ['sample'],
      categories: ['demo'],
    },
  });
  console.log(`seeded ${record.id} -> ${record.filename}`);
}
console.log(`Done: ${count} demo photos.`);
