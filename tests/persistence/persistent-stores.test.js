import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSqlRepository } from '../../src/data/sql.repository.js';
import { createPgSessionStore } from '../../src/auth/session.pgstore.js';
import { createRepository } from '../../src/data/index.js';
import { makeTestConfig } from '../helpers.js';

const IS_PROD = {
  NODE_ENV: 'production',
  SESSION_SECRET: 'x'.repeat(48),
  SESSION_STORE: 'sql',
  DB_DRIVER: 'sql',
  DB_URL: 'postgres://user:pass@db.internal:5432/yearbook',
  STORAGE_DRIVER: 'r2',
  GOOGLE_CLIENT_ID: 'id',
  GOOGLE_CLIENT_SECRET: 'secret',
  GOOGLE_CALLBACK_URL: 'https://example.com/cb',
  R2_ACCOUNT_ID: 'a',
  R2_ACCESS_KEY_ID: 'k',
  R2_SECRET_ACCESS_KEY: 's',
  R2_BUCKET: 'b',
};

/** Minimal pg Pool double backed by an in-memory table. */
function makeFakePool() {
  const rows = new Map(); // id -> { data, created_at }
  let duplicateNext = false;
  return {
    setDuplicateNext() {
      duplicateNext = true;
    },
    async query(text, params) {
      if (text.includes('CREATE TABLE')) return { rows: [], rowCount: 0 };
      if (text.startsWith('INSERT INTO photos')) {
        const [id, dataJson, createdAt] = params;
        if (duplicateNext || rows.has(id)) {
          const err = new Error('duplicate key');
          err.code = '23505';
          throw err;
        }
        rows.set(id, { data: JSON.parse(dataJson), created_at: createdAt });
        return { rows: [], rowCount: 1 };
      }
      if (text.startsWith('SELECT data FROM photos WHERE id')) {
        const row = rows.get(params[0]);
        return { rows: row ? [{ data: row.data }] : [], rowCount: row ? 1 : 0 };
      }
      if (text.startsWith('SELECT data FROM photos')) {
        return { rows: [...rows.values()].map((row) => ({ data: row.data })), rowCount: rows.size };
      }
      if (text.startsWith('UPDATE photos')) {
        const row = rows.get(params[0]);
        if (!row) return { rows: [], rowCount: 0 };
        row.data = JSON.parse(params[1]);
        return { rows: [], rowCount: 1 };
      }
      if (text.startsWith('DELETE FROM photos')) {
        return { rows: [], rowCount: rows.delete(params[0]) ? 1 : 0 };
      }
      if (text.startsWith('SELECT count(*)')) {
        return { rows: [{ count: rows.size }], rowCount: 1 };
      }
      throw new Error(`Unexpected query: ${text.slice(0, 40)}`);
    },
  };
}

test('SQL repository satisfies the repository contract (fake pool)', async (t) => {
  const pool = makeFakePool();
  const repository = await createSqlRepository(makeTestConfig(IS_PROD), { pool });

  const record = {
    id: 'ph-sql-1',
    filename: 'graduation.jpg',
    storageKey: 'photos/full/ph-sql-1.jpg',
    thumbKey: 'photos/thumb/ph-sql-1.jpg',
    personIds: [],
    collections: ['ceremony'],
    tags: ['grad'],
    categories: [],
    caption: 'Graduation',
    section: 'IMS13',
    year: 2026,
    width: 100,
    height: 80,
    thumbWidth: 48,
    thumbHeight: 38,
    exifStripped: true,
    createdAt: '2026-08-29T10:00:00.000Z',
    updatedAt: '2026-08-29T10:00:00.000Z',
    schemaVersion: 1,
  };

  await t.test('create + get round trip', async () => {
    await repository.createPhoto(record);
    const loaded = await repository.getPhoto('ph-sql-1');
    assert.equal(loaded.caption, 'Graduation');
    assert.equal(loaded.schemaVersion, 1);
  });

  await t.test('duplicate id maps to DUPLICATE_ID', async () => {
    pool.setDuplicateNext();
    await assert.rejects(() => repository.createPhoto(record), (err) => err.code === 'DUPLICATE_ID');
  });

  await t.test('update + count + delete', async () => {
    const updated = { ...record, caption: 'Updated', updatedAt: '2026-08-30T00:00:00.000Z' };
    const result = await repository.updatePhoto(record.id, updated);
    assert.equal(result.caption, 'Updated');
    assert.equal(await repository.countPhotos(), 1);
    const list = await repository.listPhotos({ tag: 'grad' });
    assert.equal(list.total, 1);
    assert.equal(await repository.deletePhoto(record.id), true);
    assert.equal(await repository.countPhotos(), 0);
    assert.equal(await repository.deletePhoto('missing'), false);
  });
});

test('SQL session store implements the express-session contract (fake pool)', async (t) => {
  const sessions = new Map(); // sid -> { sess, expire }
  const pool = {
    async query(text, params) {
      if (text.includes('CREATE TABLE')) return { rows: [], rowCount: 0 };
      if (text.startsWith('SELECT sess')) {
        const row = sessions.get(params[0]);
        if (!row || row.expire <= Date.now()) return { rows: [] };
        return { rows: [{ sess: row.sess }] };
      }
      if (text.startsWith('INSERT INTO sessions')) {
        sessions.set(params[0], { sess: JSON.parse(params[1]), expire: Date.now() + 60_000 });
        return { rows: [], rowCount: 1 };
      }
      if (text.startsWith('DELETE FROM sessions')) {
        return { rows: [], rowCount: sessions.delete(params[0]) ? 1 : 0 };
      }
      if (text.startsWith('UPDATE sessions')) {
        const row = sessions.get(params[0]);
        if (row) {
          row.sess = JSON.parse(params[1]);
          row.expire = Date.now() + 60_000;
        }
        return { rows: [], rowCount: row ? 1 : 0 };
      }
      throw new Error(`Unexpected query: ${text.slice(0, 40)}`);
    },
  };

  const store = await createPgSessionStore(makeTestConfig(IS_PROD), { pool });

  await t.test('set -> get round trip', async () => {
    await new Promise((resolve, reject) =>
      store.set('sid-1', { cookie: { maxAge: 60_000 }, user: { email: 'a@b.c' } }, (err) => (err ? reject(err) : resolve())),
    );
    const loaded = await new Promise((resolve, reject) => store.get('sid-1', (err, sess) => (err ? reject(err) : resolve(sess))));
    assert.equal(loaded.user.email, 'a@b.c');
  });

  await t.test('destroy removes the session', async () => {
    await new Promise((resolve, reject) => store.destroy('sid-1', (err) => (err ? reject(err) : resolve())));
    const loaded = await new Promise((resolve, reject) => store.get('sid-1', (err, sess) => (err ? reject(err) : resolve(sess))));
    assert.equal(loaded, null);
  });

  await t.test('touch refreshes without error', async () => {
    await new Promise((resolve, reject) =>
      store.set('sid-2', { cookie: { maxAge: 60_000 }, user: {} }, (err) => (err ? reject(err) : resolve())),
    );
    await new Promise((resolve, reject) => store.touch('sid-2', { cookie: { maxAge: 60_000 }, user: {} }, (err) => (err ? reject(err) : resolve())));
    assert.ok(await new Promise((resolve) => store.get('sid-2', (_err, sess) => resolve(Boolean(sess)))));
  });
});

test('repository factory selects json for development', async () => {
  const repository = await createRepository(makeTestConfig());
  assert.equal(typeof repository.createPhoto, 'function');
  assert.equal(await repository.countPhotos(), 0);
});

test('production session factory refuses file store even when env validation is bypassed', async () => {
  const { sessionMiddleware } = await import('../../src/auth/session.js');
  const config = makeTestConfig(IS_PROD);
  const fileConfig = { ...config, session: { ...config.session, store: 'file' } };
  await assert.rejects(() => sessionMiddleware(fileConfig), /file.*cannot be used in production/i);
});
