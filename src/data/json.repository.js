import fs from 'node:fs/promises';
import path from 'node:path';
import { assertRepository } from './repository.js';
import { migrate, SCHEMA_VERSION } from './schema.js';

/**
 * JSON file PhotoRepository - DEVELOPMENT store (config/env.js refuses JSON
 * metadata in production). The ONLY module allowed to touch photo JSON.
 *
 * Durability: atomic writes (temp file + rename). A malformed data file is
 * quarantined to *.corrupt (never silently overwritten) and the store starts
 * empty so the app keeps working; records load through schema migration.
 */
export function createJsonRepository({ file }) {
  async function readAll() {
    let raw;
    try {
      raw = await fs.readFile(file, 'utf8');
    } catch (err) {
      if (err?.code === 'ENOENT') return [];
      throw err;
    }
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) throw new Error('metadata root must be an array');
      return parsed.map(migrate).filter(Boolean);
    } catch (err) {
      const corrupt = `${file}.corrupt`;
      await fs.rename(file, corrupt).catch(() => {});
      throw Object.assign(new Error(`Metadata file was malformed and was quarantined to ${corrupt}: ${err.message}`), {
        code: 'METADATA_CORRUPT',
      });
    }
  }

  async function writeAll(records) {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
    await fs.writeFile(tmp, `${JSON.stringify(records, null, 2)}\n`, 'utf8');
    await fs.rename(tmp, file);
  }

  const matchesLabel = (list, wanted) => list.some((item) => item.toLowerCase() === wanted.toLowerCase());

  const repository = {
    async createPhoto(record) {
      const records = await readAll();
      if (records.some((r) => r.id === record.id)) {
        throw Object.assign(new Error(`Photo id already exists: ${record.id}`), { code: 'DUPLICATE_ID', status: 409 });
      }
      records.push(record);
      await writeAll(records);
      return record;
    },

    async getPhoto(id) {
      const records = await readAll();
      return records.find((r) => r.id === id) ?? null;
    },

    async listPhotos(query = {}) {
      const records = await readAll();
      const {
        collection,
        tag,
        category,
        section,
        year,
        personId,
        sort = 'newest',
      } = query;

      let items = records;
      if (collection) items = items.filter((r) => matchesLabel(r.collections, collection));
      if (tag) items = items.filter((r) => matchesLabel(r.tags, tag));
      if (category) items = items.filter((r) => matchesLabel(r.categories, category));
      if (section) items = items.filter((r) => r.section.toLowerCase() === String(section).toLowerCase());
      if (year !== undefined && year !== null && year !== '') items = items.filter((r) => r.year === Number(year));
      if (personId) items = items.filter((r) => matchesLabel(r.personIds, personId));

      items = [...items].sort((a, b) => {
        // Tie-break on id so same-millisecond records keep a stable order.
        const cmp =
          String(a.createdAt).localeCompare(String(b.createdAt)) || String(a.id).localeCompare(String(b.id));
        return sort === 'oldest' ? cmp : -cmp;
      });

      const total = items.length;
      const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 200);
      const offset = Math.max(Number(query.offset) || 0, 0);
      return { items: items.slice(offset, offset + limit), total, limit, offset };
    },

    async updatePhoto(id, patch) {
      const records = await readAll();
      const index = records.findIndex((r) => r.id === id);
      if (index === -1) return null;
      records[index] = patch;
      await writeAll(records);
      return patch;
    },

    async deletePhoto(id) {
      const records = await readAll();
      const next = records.filter((r) => r.id !== id);
      if (next.length === records.length) return false;
      await writeAll(next);
      return true;
    },

    async countPhotos() {
      return (await readAll()).length;
    },
  };

  return assertRepository(repository);
}

export { SCHEMA_VERSION };
