import fs from 'node:fs/promises';
import path from 'node:path';
import { assertDriverContract, normalizeKey, StorageError } from './driver.js';

/**
 * Local filesystem storage - DEVELOPMENT ONLY (config/env.js refuses this
 * driver in production). Writes are atomic: temp file + rename.
 * `rootDir` override exists for test isolation.
 */
export function createLocalStorage(config, { rootDir } = {}) {
  const baseDir = rootDir ?? config.storage.uploadDir ?? 'uploads';
  const resolvedRoot = path.resolve(baseDir);

  const resolveSafe = (key) => {
    const normalized = normalizeKey(key);
    const resolved = path.resolve(resolvedRoot, normalized);
    if (!resolved.startsWith(resolvedRoot + path.sep) && resolved !== resolvedRoot) {
      throw new StorageError('INVALID_KEY', `Storage key escapes the upload root: "${key}"`);
    }
    return resolved;
  };

  const driver = {
    name: 'local',

    async save(key, buffer) {
      const target = resolveSafe(key);
      await fs.mkdir(path.dirname(target), { recursive: true });
      const tmp = `${target}.tmp-${process.pid}-${Date.now()}`;
      await fs.writeFile(tmp, buffer);
      await fs.rename(tmp, target);
      return { key: normalizeKey(key), size: buffer.length };
    },

    async read(key) {
      const target = resolveSafe(key);
      try {
        return await fs.readFile(target);
      } catch (err) {
        if (err?.code === 'ENOENT') {
          throw new StorageError('NOT_FOUND', `Object not found: "${key}"`, err);
        }
        throw new StorageError('READ_FAILED', `Failed to read "${key}"`, err);
      }
    },

    async delete(key) {
      const target = resolveSafe(key);
      await fs.rm(target, { force: true });
    },

    async exists(key) {
      const target = resolveSafe(key);
      try {
        await fs.access(target);
        return true;
      } catch {
        return false;
      }
    },

    async stat(key) {
      const target = resolveSafe(key);
      try {
        const stats = await fs.stat(target);
        return { key: normalizeKey(key), size: stats.size };
      } catch (err) {
        if (err?.code === 'ENOENT') {
          throw new StorageError('NOT_FOUND', `Object not found: "${key}"`, err);
        }
        throw new StorageError('STAT_FAILED', `Failed to stat "${key}"`, err);
      }
    },

    publicUrl() {
      return null; // dev objects are served by the app itself
    },
  };

  return assertDriverContract(driver);
}
