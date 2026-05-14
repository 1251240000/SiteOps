/**
 * Auth service primitives.
 *
 * Pure functions over the DB: password verification (single-admin),
 * API-key verification, and scope checks. The HTTP layer in
 * `apps/web/lib/with-api.ts` glues these to requests; the worker can also
 * import them for any admin-only maintenance endpoints.
 *
 * Design notes
 * ------------
 * - We never return the password hash or the raw key hash. Callers get the
 *   safe "view" types defined below.
 * - On any negative outcome (missing user, wrong password, unknown key,
 *   revoked/expired key, missing scope) we return `null`. Callers translate
 *   to HTTP 401/403; we deliberately don't throw so timing on the call site
 *   stays uniform.
 * - bcrypt compare is intentionally run even when the user is not found, to
 *   even out timing (`comparePassword` against a "dummy" hash so we still do
 *   the same amount of CPU work).
 */

import { and, eq, isNull, sql } from 'drizzle-orm';

import { apiKeys, type ApiKey, type Db, users, type User } from '@siteops/db';
import {
  API_KEY_PREFIX_LENGTH,
  apiKeyPrefix,
  compareApiKey,
  comparePassword,
} from '@siteops/shared';

/** What the HTTP layer is allowed to see about the logged-in admin. */
export type AuthenticatedUser = {
  id: string;
  email: string;
  name: string | null;
};

/** What the HTTP layer is allowed to see about an authenticated API key. */
export type AuthenticatedApiKey = {
  id: string;
  name: string;
  scopes: string[];
};

/**
 * A stable bcrypt hash of a random string, used to keep timing roughly
 * symmetric when the user lookup misses. Generated lazily on first use so
 * we pay the hash cost once per process, not on every miss.
 */
let dummyHashPromise: Promise<string> | undefined;

async function getDummyHash(): Promise<string> {
  if (!dummyHashPromise) {
    // Lazy import to avoid a top-level dep on bcryptjs in this module's
    // public surface (it's already a transitive dep via @siteops/shared).
    const { hashPassword } = await import('@siteops/shared');
    dummyHashPromise = hashPassword('dummy-password-for-timing-balance-do-not-trust');
  }
  return dummyHashPromise;
}

export type VerifyAdminPasswordInput = {
  email: string;
  password: string;
};

/**
 * Validate an admin's email + password against the `users` table.
 *
 * Returns the safe user view on success, `null` on any failure (unknown
 * user, wrong password, malformed hash, etc.). Always performs at least
 * one bcrypt compare to keep timing roughly constant.
 */
export async function verifyAdminPassword(
  db: Db,
  input: VerifyAdminPasswordInput,
): Promise<AuthenticatedUser | null> {
  const email = input.email.trim().toLowerCase();
  if (!email || !input.password) {
    // Still spend a compare cycle on the dummy hash to even out timing.
    await comparePassword(input.password ?? '', await getDummyHash());
    return null;
  }

  const found = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      passwordHash: users.passwordHash,
    })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  const row: Pick<User, 'id' | 'email' | 'name' | 'passwordHash'> | undefined = found[0];

  if (!row) {
    await comparePassword(input.password, await getDummyHash());
    return null;
  }

  const ok = await comparePassword(input.password, row.passwordHash);
  if (!ok) return null;

  return { id: row.id, email: row.email, name: row.name };
}

/**
 * Validate a bearer API key (plaintext) against the `api_keys` table.
 *
 * Look-up strategy:
 *  1. Slice the first `API_KEY_PREFIX_LENGTH` chars and find candidate rows
 *     by `key_prefix` (indexed). In practice there is one match; we tolerate
 *     ties for forward compatibility.
 *  2. bcrypt-compare against every candidate's `key_hash`.
 *  3. Reject if `revoked_at` is set or `expires_at` is in the past.
 *  4. On success, asynchronously stamp `last_used_at = now()` (best effort,
 *     swallowed if it fails so a transient DB write error never 401's a
 *     legitimate caller).
 */
export async function verifyApiKey(db: Db, plaintext: string): Promise<AuthenticatedApiKey | null> {
  if (!plaintext || plaintext.length < API_KEY_PREFIX_LENGTH) return null;

  const prefix = apiKeyPrefix(plaintext);
  const rows = await db
    .select({
      id: apiKeys.id,
      name: apiKeys.name,
      keyHash: apiKeys.keyHash,
      scopes: apiKeys.scopes,
      expiresAt: apiKeys.expiresAt,
      revokedAt: apiKeys.revokedAt,
    })
    .from(apiKeys)
    .where(and(eq(apiKeys.keyPrefix, prefix), isNull(apiKeys.revokedAt)));

  const now = new Date();
  type Row = Pick<ApiKey, 'id' | 'name' | 'keyHash' | 'scopes' | 'expiresAt' | 'revokedAt'>;
  const candidates: Row[] = rows;

  for (const row of candidates) {
    if (row.expiresAt && row.expiresAt.getTime() <= now.getTime()) continue;
    const ok = await compareApiKey(plaintext, row.keyHash);
    if (!ok) continue;

    // Stamp last_used_at; failures are non-fatal.
    void db
      .update(apiKeys)
      .set({ lastUsedAt: sql`now()` })
      .where(eq(apiKeys.id, row.id))
      .catch(() => undefined);

    return { id: row.id, name: row.name, scopes: row.scopes };
  }

  return null;
}

/**
 * `true` iff the key's scope set is a superset of `required` (every
 * required scope is present). `required` empty/undefined → always true.
 *
 * Wildcard `*` in the key's scopes grants everything.
 */
export function checkScopes(
  key: Pick<AuthenticatedApiKey, 'scopes'>,
  required: readonly string[] | undefined,
): boolean {
  if (!required || required.length === 0) return true;
  const granted = new Set(key.scopes);
  if (granted.has('*')) return true;
  for (const scope of required) {
    if (!granted.has(scope)) return false;
  }
  return true;
}
