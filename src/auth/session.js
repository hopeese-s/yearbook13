import path from 'node:path';
import session from 'express-session';
import FileStoreFactory from 'session-file-store';
import { paths } from '../config/paths.js';

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Session middleware factory (BUILD-PLAN.md U1).
 *
 * Development: file-backed store (survives restarts; never MemoryStore).
 * Production:  REQUIRES a persistent store:
 *   - SESSION_STORE=sql   -> PostgreSQL store (config.db.url must be set)
 *   - SESSION_STORE=redis -> not implemented yet; boot fails loudly
 * The switch is config-driven; auth business logic never changes stores.
 */
export async function sessionMiddleware(config, { fileStoreDir } = {}) {
  if (config.session.store === 'file') {
    if (config.isProd) {
      throw new Error('SESSION_STORE="file" cannot be used in production');
    }
    const FileStore = FileStoreFactory(session);
    return session({
      name: 'ims13.sid',
      secret: config.session.secret,
      resave: false,
      saveUninitialized: false,
      rolling: true,
      store: new FileStore({
        path: fileStoreDir ?? paths.sessions(config),
        ttl: SESSION_TTL_MS / 1000,
        logFn: () => {},
      }),
      cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: config.session.secureCookies,
        maxAge: SESSION_TTL_MS,
      },
    });
  }

  if (config.session.store === 'sql') {
    if (!config.db.url) {
      throw new Error('SESSION_STORE="sql" requires DB_URL to be configured');
    }
    const { createPgSessionStore } = await import('./session.pgstore.js');
    const store = await createPgSessionStore(config);
    return session({
      name: 'ims13.sid',
      secret: config.session.secret,
      resave: false,
      saveUninitialized: false,
      rolling: true,
      store,
      cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: config.session.secureCookies,
        maxAge: SESSION_TTL_MS,
      },
    });
  }

  throw new Error(
    `SESSION_STORE="${config.session.store}" is not implemented; use "file" (development) or "sql" (production)`,
  );
}

export const SESSION_COOKIE_MAX_AGE_MS = SESSION_TTL_MS;
export const sessionPathHelpers = { resolve: (config) => path.resolve(paths.sessions(config)) };
