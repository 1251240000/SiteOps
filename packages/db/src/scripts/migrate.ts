import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

import { loadLocalEnv, requireEnv } from './_env.js';

async function main(): Promise<void> {
  loadLocalEnv();
  const url = requireEnv('DATABASE_URL');

  // Use a dedicated single-connection client; migrations want a single session.
  const sql = postgres(url, { max: 1, prepare: false });
  const db = drizzle(sql);

  console.warn(`[db:migrate] applying migrations to ${redact(url)}`);
  await migrate(db, { migrationsFolder: 'migrations' });
  console.warn('[db:migrate] done');

  await sql.end({ timeout: 5 });
}

function redact(url: string): string {
  try {
    const u = new URL(url);
    if (u.password) u.password = '***';
    return u.toString();
  } catch {
    return url;
  }
}

main().catch((err) => {
  console.error('[db:migrate] failed', err);
  process.exit(1);
});
