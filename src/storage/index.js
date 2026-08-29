import { StorageError } from './driver.js';
import { createLocalStorage } from './local.driver.js';
import { createR2Storage } from './r2.driver.js';

/**
 * Storage composition root. Selection is config-driven and already
 * guarded by config/env.js (production cannot select "local").
 * `options` forwards test doubles (e.g. rootDir, s3Client).
 */
export async function createStorage(config, options = {}) {
  switch (config.storage.driver) {
    case 'local':
      return createLocalStorage(config, options);
    case 'r2':
      return createR2Storage(config, options);
    default:
      throw new StorageError('INVALID_DRIVER', `Unknown storage driver: "${config.storage.driver}"`);
  }
}

export { StorageError, normalizeKey } from './driver.js';
