import session from 'express-session';

/**
 * PostgreSQL session store - PRODUCTION (SESSION_STORE=sql, BUILD-PLAN.md U1).
 * Implements the express-session Store contract: get/set/destroy/touch.
 * `pool` injection exists for tests; the pg module is imported dynamically.
 */
export async function createPgSessionStore(config, { pool } = {}) {
  const { Pool } = await import('pg');
  const db =
    pool ??
    new Pool({
      connectionString: config.db.url,
      max: 5,
      ssl: config.db.url.includes('localhost') || config.db.url.includes('127.0.0.1') ? false : { rejectUnauthorized: false },
    });

  await db.query(`
    CREATE TABLE IF NOT EXISTS sessions (
      sid TEXT PRIMARY KEY,
      sess JSONB NOT NULL,
      expire TIMESTAMPTZ NOT NULL
    )
  `);

  const PgSession = class extends session.Store {
    async get(sid, callback) {
      try {
        const { rows } = await db.query('SELECT sess FROM sessions WHERE sid = $1 AND expire > now()', [sid]);
        callback(null, rows[0]?.sess ?? null);
      } catch (err) {
        callback(err);
      }
    }

    async set(sid, sess, callback) {
      const ttlMs = typeof sess?.cookie?.maxAge === 'number' ? sess.cookie.maxAge : 7 * 24 * 60 * 60 * 1000;
      try {
        await db.query(
          `INSERT INTO sessions (sid, sess, expire) VALUES ($1, $2, now() + make_interval(secs => $3))
           ON CONFLICT (sid) DO UPDATE SET sess = EXCLUDED.sess, expire = EXCLUDED.expire`,
          [sid, JSON.stringify(sess), ttlMs / 1000],
        );
        callback?.(null);
      } catch (err) {
        callback?.(err);
      }
    }

    async destroy(sid, callback) {
      try {
        await db.query('DELETE FROM sessions WHERE sid = $1', [sid]);
        callback?.(null);
      } catch (err) {
        callback?.(err);
      }
    }

    async touch(sid, sess, callback) {
      const ttlMs = typeof sess?.cookie?.maxAge === 'number' ? sess.cookie.maxAge : 7 * 24 * 60 * 60 * 1000;
      try {
        await db.query('UPDATE sessions SET sess = $2, expire = now() + make_interval(secs => $3) WHERE sid = $1', [
          sid,
          JSON.stringify(sess),
          ttlMs / 1000,
        ]);
        callback?.(null);
      } catch (err) {
        callback?.(err);
      }
    }
  };

  return new PgSession();
}
