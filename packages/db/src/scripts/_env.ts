import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { config as loadEnv } from 'dotenv';

/**
 * Load `.env.local` from the repo root (preferred for dev) on top of any
 * variables already set. Idempotent: existing env wins.
 *
 * `quiet: true` suppresses dotenv@17's "◇ injected env (N) from …" tip
 * line. The per-script `db:*` runners produce their own log lines, so
 * the dotenv noise was confusing more than informative (e.g. "(0)"
 * reads as "didn't load anything" when really the values are already
 * in `process.env`).
 */
export function loadLocalEnv(): void {
  // walk up from this file (src/scripts → src → packages/db → packages → repo root)
  let dir = resolve(import.meta.dirname ?? process.cwd(), '..', '..', '..', '..');
  for (let i = 0; i < 6; i++) {
    const candidate = resolve(dir, '.env.local');
    if (existsSync(candidate)) {
      loadEnv({ path: candidate, quiet: true });
      return;
    }
    const parent = resolve(dir, '..');
    if (parent === dir) break;
    dir = parent;
  }
}

export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.length === 0) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return v;
}
