import { createDb, type Db } from '@siteops/db';

import { getWorkerEnv } from './env.js';

let cached: Db | undefined;

export function getWorkerDb(): Db {
  if (cached) return cached;
  const env = getWorkerEnv();
  cached = createDb(env.DATABASE_URL).db;
  return cached;
}
