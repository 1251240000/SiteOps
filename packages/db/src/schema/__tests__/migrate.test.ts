import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(HERE, '..', '..', '..', 'migrations');

let pg: PGlite;

beforeAll(async () => {
  pg = await PGlite.create({ extensions: { pgcrypto } });
});

afterAll(async () => {
  await pg.close();
});

describe('migrations', () => {
  it('apply once: all tables + extension exist', async () => {
    const db = drizzle(pg);
    await migrate(db, { migrationsFolder: MIGRATIONS_DIR });

    const ext = await pg.query<{ extname: string }>(
      `SELECT extname FROM pg_extension WHERE extname = 'pgcrypto'`,
    );
    expect(ext.rows).toHaveLength(1);

    const tables = await pg.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
    );
    const names = tables.rows.map((r) => r.tablename);
    for (const t of [
      'users',
      'api_keys',
      'sites',
      'domains',
      'deployments',
      'uptime_checks',
      'audit_runs',
      'audit_findings',
      'metrics_daily',
      'search_console_daily',
      'adsense_daily',
      'errors',
      'alert_channels',
      'alert_rules',
      'alerts',
      'jobs_log',
      'agent_runs',
      'integrations_state',
      'integration_credentials',
      'affiliate_entries',
      'site_costs',
      'tasks',
      'webhook_events',
    ]) {
      expect(names).toContain(t);
    }
  });

  it('apply twice: idempotent (no new SQL executed)', async () => {
    const db = drizzle(pg);
    // The journal table records each applied migration; second migrate() call
    // should not add a row.
    const before = await pg.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM drizzle.__drizzle_migrations`,
    );
    await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
    const after = await pg.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM drizzle.__drizzle_migrations`,
    );
    expect(after.rows[0]?.count).toBe(before.rows[0]?.count);
  });
});
