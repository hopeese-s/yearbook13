import { assertRepository } from './repository.js';
import { migrate } from './schema.js';
import { getSharedPool } from './pg-pool.js';

/**
 * SQL (PostgreSQL) PhotoRepository - PRODUCTION store (DB_DRIVER=sql).
 * Same interface as the JSON repository; metadata lives in a JSONB column
 * so the photo model (collections/tags/categories/sections) needs no DDL
 * changes as it grows.
 *
 * `pool` injection exists for tests; production builds a real Pool from
 * the validated DB_URL (one pool shared with the session store, see
 * pg-pool.js). The `pg` module loads only when this driver is selected.
 */
export async function createSqlRepository(config, { pool } = {}) {
  const db = pool ?? (await getSharedPool(config.db.url));

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
      const { collection, tag, category, section, year, personId, search, sort = 'newest' } = query;
      const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 5000);
      const offset = Math.max(Number(query.offset) || 0, 0);
      const hasFilter =
        collection || tag || category || section || personId || (year !== undefined && year !== null && year !== '') ||
        (search && String(search).trim());

      if (!hasFilter) {
        // Fast path (the public gallery): sort + paginate in PostgreSQL so only
        // one page of rows is transferred and parsed instead of every photo.
        // COLLATE "C" = plain code-point order, matching the JS comparison below.
        const dir = sort === 'oldest' ? 'ASC' : 'DESC';
        const [{ rows }, { rows: countRows }] = await Promise.all([
          db.query(
            `SELECT data FROM photos ORDER BY data->>'createdAt' COLLATE "C" ${dir}, id COLLATE "C" ${dir} LIMIT $1 OFFSET $2`,
            [limit, offset],
          ),
          db.query('SELECT count(*)::int AS count FROM photos'),
        ]);
        const items = rows.map((row) => migrate(row.data)).filter(Boolean);
        return { items, total: countRows[0].count, limit, offset };
      }

      // Filtered queries: yearbook scale is small, so filtering happens after
      // load with semantics identical to the JSON repository.
      const { rows } = await db.query('SELECT data FROM photos');
      let items = rows.map((row) => migrate(row.data)).filter(Boolean);
      const matchesLabel = (list, wanted) => list.some((item) => item.toLowerCase() === wanted.toLowerCase());

      if (collection) items = items.filter((r) => matchesLabel(r.collections, collection));
      if (tag) items = items.filter((r) => matchesLabel(r.tags, tag));
      if (category) items = items.filter((r) => matchesLabel(r.categories, category));
      if (section) items = items.filter((r) => (r.section ?? '').toLowerCase() === String(section).toLowerCase());
      if (year !== undefined && year !== null && year !== '') items = items.filter((r) => r.year === Number(year));
      if (personId) items = items.filter((r) => matchesLabel(r.personIds, personId));
      if (search && String(search).trim()) {
        const term = String(search).trim().toLowerCase();
        items = items.filter(
          (r) =>
            (r.caption ?? '').toLowerCase().includes(term) ||
            (r.filename ?? '').toLowerCase().includes(term) ||
            (r.section ?? '').toLowerCase().includes(term) ||
            (r.collections ?? []).some((item) => item.toLowerCase().includes(term)) ||
            (r.tags ?? []).some((item) => item.toLowerCase().includes(term)) ||
            (r.categories ?? []).some((item) => item.toLowerCase().includes(term)) ||
            (r.personIds ?? []).some((item) => item.toLowerCase().includes(term)),
        );
      }

      items = [...items].sort((a, b) => {
        const cmp =
          String(a.createdAt).localeCompare(String(b.createdAt)) || String(a.id).localeCompare(String(b.id));
        return sort === 'oldest' ? cmp : -cmp;
      });

      const total = items.length;
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

    async deletePhotos(ids) {
      if (!Array.isArray(ids) || ids.length === 0) return 0;
      const { rowCount } = await db.query('DELETE FROM photos WHERE id = ANY($1)', [ids]);
      return rowCount;
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
