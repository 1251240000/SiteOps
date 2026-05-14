import { drizzle } from 'drizzle-orm/postgres-js';
import postgres, { type Options, type Sql } from 'postgres';

import * as schema from './schema/index.js';

export type DbSchema = typeof schema;
export type Db = ReturnType<typeof drizzle<DbSchema>>;

type ClientHandle = {
  db: Db;
  sql: Sql;
};

type ConnectionKey = string;

/**
 * Module-scoped cache so that repeated calls inside the same process re-use a
 * pool. Tests and CLIs can opt out by calling `closeDb()` before exit.
 */
const handles = new Map<ConnectionKey, ClientHandle>();

export type CreateDbOptions = {
  /** Cache by URL so multiple imports share a single pool. Defaults to true. */
  cache?: boolean;
  /** Forwarded to `postgres()`. */
  postgres?: Options<Record<string, never>>;
};

/**
 * Create (or fetch from cache) a Drizzle client backed by `postgres-js`.
 *
 * `connectionString` must be provided explicitly; we do not read `process.env`
 * here to keep the package free of side effects.
 */
export function createDb(connectionString: string, options: CreateDbOptions = {}): ClientHandle {
  const cache = options.cache ?? true;
  if (cache) {
    const cached = handles.get(connectionString);
    if (cached) return cached;
  }

  const sql = postgres(connectionString, {
    max: 10,
    idle_timeout: 30,
    connect_timeout: 10,
    prepare: false,
    ...options.postgres,
  });
  const db = drizzle(sql, { schema });
  const handle: ClientHandle = { db, sql };
  if (cache) handles.set(connectionString, handle);
  return handle;
}

/** Close all cached pools. Safe to call multiple times. */
export async function closeDb(): Promise<void> {
  const all = Array.from(handles.values());
  handles.clear();
  await Promise.all(all.map((h) => h.sql.end({ timeout: 5 })));
}
