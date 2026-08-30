import path from 'node:path';
import { createJsonRepository } from './json.repository.js';
import { paths } from '../config/paths.js';

/**
 * Metadata repository composition root (BUILD-PLAN.md R2/U-series).
 * DB_DRIVER=json (dev) -> JSON repository; DB_DRIVER=sql (prod) -> PostgreSQL.
 * `options` forwards test doubles (file path / pool). The pg module loads
 * only for the sql driver.
 */
export async function createRepository(config, options = {}) {
  switch (config.db.driver) {
    case 'json':
      return createJsonRepository({
        file: options.file ?? path.join(paths.data(config), 'photos.json'),
      });
    case 'sql': {
      const { createSqlRepository } = await import('./sql.repository.js');
      return createSqlRepository(config, options);
    }
    default:
      throw new Error(`Unknown DB driver: "${config.db.driver}"`);
  }
}
