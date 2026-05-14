import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';

import * as schema from './schema/index.js';

export type TestDb = PgliteDatabase<typeof schema> & {
  $client: PGlite;
};

export type TestDbHandle = {
  db: TestDb;
  pg: PGlite;
  /** Drop and re-apply schema; useful between tests if migrations are slow. */
  reset(): Promise<void>;
  /** Release WASM resources. Call from `afterAll`. */
  close(): Promise<void>;
};

const HERE = dirname(fileURLToPath(import.meta.url));
/** packages/db/migrations — resolved relative to this file (src or dist). */
const MIGRATIONS_DIR = resolve(HERE, '..', 'migrations');

/**
 * Boots an in-process Postgres (PGlite) with pgcrypto loaded, then applies
 * every migration in `packages/db/migrations`. Hermetic; no docker needed.
 */
export async function createTestDb(): Promise<TestDbHandle> {
  const pg = await PGlite.create({ extensions: { pgcrypto } });
  const db = drizzle(pg, { schema }) as TestDb;
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });

  return {
    db,
    pg,
    async reset() {
      // Truncate every user table in dependency-safe order via CASCADE.
      await pg.exec(`
        DO $$
        DECLARE r record;
        BEGIN
          FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '__drizzle_migrations') LOOP
            EXECUTE 'TRUNCATE TABLE ' || quote_ident(r.tablename) || ' RESTART IDENTITY CASCADE';
          END LOOP;
        END $$;
      `);
    },
    async close() {
      await pg.close();
    },
  };
}
