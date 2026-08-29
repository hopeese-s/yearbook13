import path from 'node:path';

/**
 * StorageDriver interface (BUILD-PLAN.md Phase 2 contract).
 * This is the ONLY storage boundary exposed to domain logic.
 *
 * All drivers implement:
 *   name: 'local' | 'r2'
 *   async save(key, buffer)  -> { key, size }
 *   async read(key)          -> Buffer (throws StorageError NOT_FOUND)
 *   async delete(key)        -> void (no-op if absent)
 *   async exists(key)        -> boolean
 *   async stat(key)          -> { key, size }
 *   publicUrl(key)           -> string | null (null when not public)
 */

export class StorageError extends Error {
  constructor(code, message, cause) {
    super(message);
    this.name = 'StorageError';
    this.code = code;
    this.cause = cause;
  }
}

/**
 * Validate + normalize an object key. Keys are namespace-relative POSIX-style
 * paths. Rejects traversal in a platform-safe way (Windows backslashes and
 * drive letters included).
 */
export function normalizeKey(key) {
  if (typeof key !== 'string' || key.length === 0) {
    throw new StorageError('INVALID_KEY', 'Storage key must be a non-empty string');
  }
  const withoutBackslashes = key.replaceAll('\\', '/');
  if (
    withoutBackslashes.split('/').includes('..') ||
    path.isAbsolute(withoutBackslashes) ||
    /^[a-zA-Z]:/.test(withoutBackslashes)
  ) {
    throw new StorageError('INVALID_KEY', `Storage key must not traverse directories: "${key}"`);
  }
  return withoutBackslashes.replaceAll(/\/+/g, '/').replace(/^\/+|\/+$/g, '');
}

const REQUIRED_METHODS = ['save', 'read', 'delete', 'exists', 'stat'];

/** Shared contract assertion so every driver satisfies the same shape. */
export function assertDriverContract(driver) {
  const missing = REQUIRED_METHODS.filter((method) => typeof driver[method] !== 'function');
  if (missing.length > 0) {
    throw new StorageError('INVALID_DRIVER', `Storage driver is missing methods: ${missing.join(', ')}`);
  }
  return driver;
}
