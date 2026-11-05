/**
 * One PostgreSQL pool shared by the photo repository and the session store.
 * Two separate pools meant up to 5 open connections (each with its own TLS
 * session + buffers); one small pool is plenty for a yearbook's traffic.
 * Idle connections close after 10 s so a quiet server holds none open, which
 * also lets Railway's App Sleeping put the service to sleep.
 */
const pools = new Map();

export async function getSharedPool(url) {
  if (!pools.has(url)) {
    pools.set(
      url,
      import('pg').then(
        ({ default: pg }) =>
          new pg.Pool({
            connectionString: url,
            max: 3,
            idleTimeoutMillis: 10_000,
            ssl: url.includes('localhost') || url.includes('127.0.0.1') ? false : { rejectUnauthorized: false },
          }),
      ),
    );
  }
  return pools.get(url);
}
