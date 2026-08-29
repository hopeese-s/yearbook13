// Thin bootstrap ONLY: load env -> build app -> listen.
// All logic lives in src/ (see BUILD-PLAN.md architecture contract).
import { loadEnv } from './src/config/env.js';
import { createApp } from './src/server/app.js';
import { logger } from './src/util/logger.js';

const config = loadEnv();
const app = createApp(config);

const server = app.listen(config.port, () => {
  logger.info(`ims13-yearbook listening on :${config.port} (${config.nodeEnv})`);
});

// Graceful shutdown for Railway restarts / SIGTERM deploys.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    logger.info(`${signal} received, closing server`);
    server.close(() => process.exit(0));
  });
}
