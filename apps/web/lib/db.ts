import { createDb, type Db } from '@siteops/db';

import { getEnv } from './env';

let cached: Db | undefined;

/**
 * Process-wide Drizzle handle. `createDb` itself memoises by URL, but we
 * keep a local cache so we don't reparse env on every call.
 */
export function getDb(): Db {
  if (cached) return cached;
  const env = getEnv();
  cached = createDb(env.DATABASE_URL).db;
  return cached;
}
