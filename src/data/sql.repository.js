import { assertRepository } from './repository.js';
import { migrate } from './schema.js';

/**
 * SQL (PostgreSQL) PhotoRepository - PRODUCTION store (DB_DRIVER=sql).
 * Same interface as the JSON repository; metadata lives in a JSONB column
 * so the photo model (collections/tags/categories/sections) needs no DDL
 * changes as it grows.
 *
 * `pool` injection exists for tests; production builds a real Pool from
 * the validated DB_URL. The `pg` module is imported dynamically so it is
 * loaded only when this driver is actually selected.
 */
export async function createSqlRepository(config, { pool } = {}) {
  const { Pool } = await import('pg');
  const db =
    pool ??
    new Pool({
      connectionString: config.db.url,
      max: 5,
      ssl: config.db.url.includes('localhost') || config.db.url.includes('127.0.0.1') ? false : { rejectUnauthorized: false },
    });

  await db.query(`
    CREATE TABLE IF NOT EXISTS photos (
      id TEXT PRIMARY KEY,
      data JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const repository = {
    async createPhoto(record) {
      try {
        await db.query('INSERT INTO photos (id, data, created_at) VALUES ($1, $2, $3)', [
          record.id,
          JSON.stringify(record),
          record.createdAt,
        ]);
        return record;
      } catch (err) {
        if (err?.code === '23505') {
          throw Object.assign(new Error(`Photo id already exists: ${record.id}`), { code: 'DUPLICATE_ID', status: 409 });
        }
        throw err;
      }
    },

    async getPhoto(id) {
      const { rows } = await db.query('SELECT data FROM photos WHERE id = $1', [id]);
      return rows[0] ? migrate(rows[0].data) : null;
    },

    async listPhotos(query = {}) {
      // Yearbook scale is small; filtering happens after load, identical
      // semantics to the JSON repository (documented trade-off).
      const { rows } = await db.query('SELECT data FROM photos');
      let items = rows.map((row) => migrate(row.data)).filter(Boolean);
      const matchesLabel = (list, wanted) => list.some((item) => item.toLowerCase() === wanted.toLowerCase());
      const { collection, tag, category, section, year, personId, sort = 'newest' } = query;

      if (collection) items = items.filter((r) => matchesLabel(r.collections, collection));
      if (tag) items = items.filter((r) => matchesLabel(r.tags, tag));
      if (category) items = items.filter((r) => matchesLabel(r.categories, category));
      if (section) items = items.filter((r) => r.section.toLowerCase() === String(section).toLowerCase());
      if (year !== undefined && year !== null && year !== '') items = items.filter((r) => r.year === Number(year));
      if (personId) items = items.filter((r) => matchesLabel(r.personIds, personId));

      items = [...items].sort((a, b) => {
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
      const { rowCount } = await db.query('UPDATE photos SET data = $2 WHERE id = $1', [id, JSON.stringify(patch)]);
      return rowCount > 0 ? patch : null;
    },

    async deletePhoto(id) {
      const { rowCount } = await db.query('DELETE FROM photos WHERE id = $1', [id]);
      return rowCount > 0;
    },

    async countPhotos() {
      const { rows } = await db.query('SELECT count(*)::int AS count FROM photos');
      return rows[0].count;
    },

    async close() {
      await db.end();
    },
  };

  return assertRepository(repository);
}
