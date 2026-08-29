import { loadEnv } from '../src/config/env.js';
import { createApp } from '../src/server/app.js';

export function makeTestConfig(overrides = {}) {
  return loadEnv({ NODE_ENV: 'test', SESSION_SECRET: 't'.repeat(48), ...overrides });
}

export function makeTestApp(overrides = {}, options = {}) {
  return createApp(makeTestConfig(overrides), options);
}
