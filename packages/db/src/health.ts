import { sql } from 'drizzle-orm';

import type { Db } from './client.js';

/**
 * Cheapest possible round-trip against the connection pool.
 *
 * Used by readiness probes (`apps/web` `/readyz`) and any future ops
 * tooling that wants to assert "we can talk to Postgres" without having
 * to import `drizzle-orm` directly. Resolves on success and rejects with
 * the underlying driver error on failure — callers are expected to wrap
 * this in their own timeout if they need a bounded wait.
 */
export async function pingDb(db: Db): Promise<void> {
  await db.execute(sql`SELECT 1`);
}
