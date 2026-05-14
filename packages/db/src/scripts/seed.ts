import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { users } from '../schema/users.js';
import { loadLocalEnv, requireEnv } from './_env.js';

const BCRYPT_COST = 12;

async function main(): Promise<void> {
  loadLocalEnv();
  const url = requireEnv('DATABASE_URL');
  const adminEmail = requireEnv('ADMIN_EMAIL');
  const adminPassword = requireEnv('ADMIN_PASSWORD');

  if (adminPassword.length < 8) {
    throw new Error('ADMIN_PASSWORD must be at least 8 characters');
  }

  const sql = postgres(url, { max: 1, prepare: false });
  const db = drizzle(sql);

  try {
    const existing = await db.select().from(users).where(eq(users.email, adminEmail)).limit(1);
    if (existing.length > 0) {
      console.warn(`[db:seed] admin already exists (${adminEmail}); skipping`);
      return;
    }

    const passwordHash = await bcrypt.hash(adminPassword, BCRYPT_COST);
    const [inserted] = await db
      .insert(users)
      .values({ email: adminEmail, passwordHash, name: 'Admin' })
      .returning({ id: users.id, email: users.email });

    console.warn(`[db:seed] created admin user ${inserted?.email} (id=${inserted?.id})`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error('[db:seed] failed', err);
  process.exit(1);
});
