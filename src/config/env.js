import { strict as assert } from 'node:assert';

const STORAGE_DRIVERS = ['local', 'r2'];
const SESSION_STORES = ['file', 'memory', 'sql', 'redis'];
const DB_DRIVERS = ['json', 'sql'];
const NODE_ENVS = ['development', 'test', 'production'];
const BODY_LIMIT_RE = /^\d+(b|kb|mb|gb)$/i;

export class ConfigError extends Error {
  constructor(failures) {
    super(`Invalid configuration:\n  - ${failures.join('\n  - ')}`);
    this.name = 'ConfigError';
    this.failures = failures;
  }
}

function requireInt(source, key, failures, { min = 1 } = {}) {
  const raw = source[key];
  const value = raw === undefined || raw === '' ? undefined : Number(raw);
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || value < min) {
    failures.push(`${key} must be an integer >= ${min} (got "${raw}")`);
    return undefined;
  }
  return value;
}

function requireEnum(source, key, allowed, failures) {
  const value = source[key];
  if (value === undefined || value === '') return undefined;
  if (!allowed.includes(value)) {
    failures.push(`${key} must be one of: ${allowed.join(' | ')} (got "${value}")`);
    return undefined;
  }
  return value;
}

function requireBodyLimit(source, key, failures) {
  const value = source[key];
  if (value === undefined || value === '') return undefined;
  if (!BODY_LIMIT_RE.test(value)) {
    failures.push(`${key} must match ${BODY_LIMIT_RE} (got "${value}")`);
    return undefined;
  }
  return value;
}

/**
 * Parse and validate environment variables into a frozen config object.
 *
 * FAIL-SAFE default: an UNSET NODE_ENV is treated as production, so a missing
 * variable can never silently bypass the production invariants. Explicit
 * development runs must set NODE_ENV=development (see .env.example).
 *
 * Production invariants enforced here (boot refuses unsafe combinations):
 *   - STORAGE_DRIVER must be "r2" (local uploads are not persistent)
 *   - SESSION_STORE must be "sql" or "redis" (file/memory are dev-only)
 *   - DB_DRIVER must be "sql" and DB_URL must be set (JSON metadata is dev-only)
 *   - SESSION_SECRET required, >= 32 chars after trim, placeholder rejected
 *   - Google OAuth credentials required (auth-only scopes; Drive is a future flow)
 *   - R2 credentials required when STORAGE_DRIVER=r2
 */
export function loadEnv(source = process.env) {
  const failures = [];

  const nodeEnv = requireEnum(source, 'NODE_ENV', NODE_ENVS, failures) ?? 'production';
  const isProd = nodeEnv === 'production';
  const isTest = nodeEnv === 'test';

  const port = requireInt(source, 'PORT', failures, { min: 1 }) ?? 3000;

  // --- Session ---
  const sessionStore = requireEnum(source, 'SESSION_STORE', SESSION_STORES, failures);
  const resolvedSessionStore = sessionStore ?? (isProd ? undefined : 'file');
  if (isProd && resolvedSessionStore === undefined) {
    failures.push('SESSION_STORE is required in production (use "sql" or "redis")');
  }
  if (isProd && (resolvedSessionStore === 'file' || resolvedSessionStore === 'memory')) {
    failures.push(`SESSION_STORE="${resolvedSessionStore}" is not persistent; production requires "sql" or "redis"`);
  }
  const sessionSecret = source.SESSION_SECRET;
  if (isProd) {
    const trimmed = sessionSecret?.trim();
    if (!trimmed || trimmed.length < 32) {
      failures.push('SESSION_SECRET is required in production and must be at least 32 characters');
    } else if (trimmed.startsWith('changeme')) {
      failures.push('SESSION_SECRET must be changed from the placeholder value');
    }
  }
  const sessionDir = source.SESSION_DIR ?? 'sessions';

  // --- Google OAuth (authentication ONLY; Drive permissions are a separate future flow) ---
  const googleClientId = source.GOOGLE_CLIENT_ID;
  const googleClientSecret = source.GOOGLE_CLIENT_SECRET;
  const googleCallbackUrl = source.GOOGLE_CALLBACK_URL;
  if (isProd) {
    if (!googleClientId) failures.push('GOOGLE_CLIENT_ID is required in production');
    if (!googleClientSecret) failures.push('GOOGLE_CLIENT_SECRET is required in production');
    if (!googleCallbackUrl) failures.push('GOOGLE_CALLBACK_URL is required in production');
  }

  const adminEmails = (source.ADMIN_EMAILS ?? '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);

  // --- Storage ---
  const storageDriver = requireEnum(source, 'STORAGE_DRIVER', STORAGE_DRIVERS, failures);
  const resolvedStorageDriver = storageDriver ?? (isProd ? undefined : 'local');
  if (isProd && resolvedStorageDriver === undefined) {
    failures.push('STORAGE_DRIVER is required in production (use "r2")');
  }
  if (isProd && resolvedStorageDriver === 'local') {
    failures.push('STORAGE_DRIVER="local" is not persistent; production requires "r2"');
  }
  const r2 = {
    accountId: source.R2_ACCOUNT_ID ?? '',
    accessKeyId: source.R2_ACCESS_KEY_ID ?? '',
    secretAccessKey: source.R2_SECRET_ACCESS_KEY ?? '',
    bucket: source.R2_BUCKET ?? '',
    publicBaseUrl: source.R2_PUBLIC_BASE_URL ?? '',
  };
  if (resolvedStorageDriver === 'r2') {
    const missing = Object.entries({
      R2_ACCOUNT_ID: r2.accountId,
      R2_ACCESS_KEY_ID: r2.accessKeyId,
      R2_SECRET_ACCESS_KEY: r2.secretAccessKey,
      R2_BUCKET: r2.bucket,
    })
      .filter(([, value]) => !value)
      .map(([key]) => key);
    if (missing.length > 0) failures.push(`STORAGE_DRIVER="r2" requires: ${missing.join(', ')}`);
  }
  const uploadDir = source.UPLOAD_DIR ?? 'uploads';
  const dataDir = source.DATA_DIR ?? 'data';
  const maxUploadBytes = requireInt(source, 'MAX_UPLOAD_BYTES', failures, { min: 1024 }) ?? 10_485_760;
  const maxUploadsPerRequest = requireInt(source, 'MAX_UPLOADS_PER_REQUEST', failures, { min: 1 }) ?? 20;

  // --- Metadata database ---
  const dbDriver = requireEnum(source, 'DB_DRIVER', DB_DRIVERS, failures);
  const resolvedDbDriver = dbDriver ?? (isProd ? undefined : 'json');
  if (isProd && resolvedDbDriver === undefined) {
    failures.push('DB_DRIVER is required in production (use "sql")');
  }
  if (isProd && resolvedDbDriver === 'json') {
    failures.push('DB_DRIVER="json" is not persistent; production requires "sql"');
  }
  const dbUrl = typeof source.DB_URL === 'string' ? source.DB_URL.trim() : '';
  const railwayDbUrl = typeof source.DATABASE_URL === 'string' ? source.DATABASE_URL.trim() : '';
  const databaseUrl = dbUrl || railwayDbUrl;
  if (isProd && resolvedDbDriver === 'sql' && !databaseUrl.trim()) {
    failures.push('DB_URL or DATABASE_URL is required in production when DB_DRIVER="sql"');
  }

  // --- Limits ---
  const jsonBodyLimit = requireBodyLimit(source, 'JSON_BODY_LIMIT', failures) ?? '1mb';
  const authRateLimit = {
    max: requireInt(source, 'AUTH_RATE_LIMIT_MAX', failures) ?? 10,
    windowMs: requireInt(source, 'AUTH_RATE_LIMIT_WINDOW_MS', failures, { min: 1000 }) ?? 60_000,
  };
  const uploadRateLimit = {
    max: requireInt(source, 'UPLOAD_RATE_LIMIT_MAX', failures) ?? 20,
    windowMs: requireInt(source, 'UPLOAD_RATE_LIMIT_WINDOW_MS', failures, { min: 1000 }) ?? 60_000,
  };

  // --- Future Drive import (strict boolean; never silently coerced) ---
  const driveRaw = source.DRIVE_IMPORT_ENABLED;
  if (driveRaw !== undefined && driveRaw !== '' && !['true', 'false'].includes(driveRaw)) {
    failures.push('DRIVE_IMPORT_ENABLED must be "true" or "false"');
  }
  const driveImportEnabled = driveRaw === 'true';

  if (failures.length > 0) throw new ConfigError(failures);

  assert(nodeEnv && port && resolvedSessionStore && resolvedStorageDriver && resolvedDbDriver);

  return Object.freeze({
    nodeEnv,
    isProd,
    isTest,
    port,
    session: Object.freeze({
      store: resolvedSessionStore,
      dir: sessionDir,
      // Dev/test boots without a configured secret get an explicitly-labeled
      // fallback; production is required to set a real one above.
      secret: sessionSecret ?? 'dev-only-not-a-real-secret-change-me',
      secureCookies: isProd,
    }),
    auth: Object.freeze({
      adminEmails,
      google: Object.freeze({
        clientId: googleClientId ?? '',
        clientSecret: googleClientSecret ?? '',
        callbackUrl: googleCallbackUrl ?? '',
      }),
      driveImportEnabled,
    }),
    storage: Object.freeze({
      driver: resolvedStorageDriver,
      uploadDir,
      dataDir,
      maxUploadBytes,
      maxUploadsPerRequest,
      r2: Object.freeze(r2),
    }),
    db: Object.freeze({ driver: resolvedDbDriver, url: databaseUrl }),
    limits: Object.freeze({ jsonBodyLimit, authRateLimit, uploadRateLimit }),
  });
}
