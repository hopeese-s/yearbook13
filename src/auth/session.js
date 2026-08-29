import path from 'node:path';
import session from 'express-session';
import FileStoreFactory from 'session-file-store';
import { paths } from '../config/paths.js';

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Session middleware factory.
 *
 * Development: file-backed store (survives server restarts; never MemoryStore).
 * Production: requires a persistent store (sql|redis). The sql store is
 * implemented in Phase 9 (BUILD-PLAN.md); until then production boot fails
 * loudly here rather than silently downgrading to an in-memory store.
 */
export function sessionMiddleware(config) {
  if (config.isProd) {
    throw new Error(
      `SESSION_STORE="${config.session.store}" requires the persistent store implementation (Phase 9). ` +
        'Production cannot use file or memory sessions.',
    );
  }
  if (config.session.store !== 'file') {
    throw new Error(`SESSION_STORE="${config.session.store}" is not implemented yet; use "file" for development`);
  }

  const FileStore = FileStoreFactory(session);
  return session({
    name: 'ims13.sid',
    secret: config.session.secret,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    store: new FileStore({
      path: paths.sessions(config),
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

export const SESSION_COOKIE_MAX_AGE_MS = SESSION_TTL_MS;
export const sessionPathHelpers = { resolve: (config) => path.resolve(paths.sessions(config)) };
