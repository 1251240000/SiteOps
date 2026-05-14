import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

const url = process.env.DATABASE_URL;

if (!url && process.env.npm_lifecycle_event !== 'db:generate') {
  // `db:generate` does not need a live connection, but `db:migrate`/`db:studio` do.
  // We still allow generate-only by leaving the URL undefined here.
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './migrations',
  casing: 'snake_case',
  strict: true,
  verbose: true,
  dbCredentials: {
    url: url ?? 'postgres://placeholder@localhost:5432/placeholder',
  },
});
