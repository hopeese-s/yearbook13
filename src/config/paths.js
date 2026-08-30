import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export const paths = Object.freeze({
  root: projectRoot,
  public: path.join(projectRoot, 'public'),
  uploads: (config) => path.resolve(projectRoot, config.storage.uploadDir),
  data: (config) => path.resolve(projectRoot, config.storage.dataDir),
  sessions: (config) => path.resolve(projectRoot, config.session.dir),
});
