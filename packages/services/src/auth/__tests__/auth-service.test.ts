import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { apiKeys, users } from '@siteops/db';
import { createTestDb, type TestDbHandle } from '@siteops/db/testing';
import { generateApiKey, hashPassword } from '@siteops/shared';

import { checkScopes, verifyAdminPassword, verifyApiKey } from '../auth-service.js';

let handle: TestDbHandle;

async function seedAdmin(): Promise<{ email: string; password: string; id: string }> {
  const email = 'admin@example.com';
  const password = 'CorrectHorseBattery!';
  const passwordHash = await hashPassword(password);
  const [row] = await handle.db
    .insert(users)
    .values({ email, passwordHash, name: 'Admin' })
    .returning({ id: users.id });
  if (!row) throw new Error('seedAdmin: insert returned no row');
  return { email, password, id: row.id };
}

async function seedKey(opts: {
  name?: string;
  scopes?: string[];
  expiresAt?: Date | null;
  revokedAt?: Date | null;
}): Promise<{ id: string; plaintext: string }> {
  const generated = await generateApiKey();
  const [row] = await handle.db
    .insert(apiKeys)
    .values({
      name: opts.name ?? 'test-key',
      keyHash: generated.hash,
      keyPrefix: generated.prefix,
      scopes: opts.scopes ?? [],
      expiresAt: opts.expiresAt ?? null,
      revokedAt: opts.revokedAt ?? null,
    })
    .returning({ id: apiKeys.id });
  if (!row) throw new Error('seedKey: insert returned no row');
  return { id: row.id, plaintext: generated.plaintext };
}

describe('auth-service', () => {
  beforeEach(async () => {
    if (!handle) handle = await createTestDb();
    await handle.reset();
  });

  afterAll(async () => {
    if (handle) await handle.close();
  });

  describe('verifyAdminPassword', () => {
    it('returns the safe user view on correct email + password', async () => {
      const admin = await seedAdmin();
      // unknown-typed access because the test db type is the pglite variant
      const user = await verifyAdminPassword(handle.db as never, {
        email: admin.email,
        password: admin.password,
      });
      // `role` defaults to 'admin' (per the schema column default).
      expect(user).toEqual({
        id: admin.id,
        email: admin.email,
        name: 'Admin',
        role: 'admin',
      });
    });

    it('is case-insensitive on email lookup', async () => {
      const admin = await seedAdmin();
      const user = await verifyAdminPassword(handle.db as never, {
        email: admin.email.toUpperCase(),
        password: admin.password,
      });
      expect(user?.id).toBe(admin.id);
    });

    it('returns null for unknown email (and still bcrypt-compares for timing)', async () => {
      await seedAdmin();
      const t0 = Date.now();
      const user = await verifyAdminPassword(handle.db as never, {
        email: 'who@nope.dev',
        password: 'anything',
      });
      const elapsed = Date.now() - t0;
      expect(user).toBeNull();
      // bcrypt cost 12 ≈ 250ms on a modern x86 core. Just assert a non-zero
      // lower bound so a future short-circuit regression would catch fire.
      expect(elapsed).toBeGreaterThan(20);
    });

    it('returns null for wrong password', async () => {
      const admin = await seedAdmin();
      const user = await verifyAdminPassword(handle.db as never, {
        email: admin.email,
        password: 'wrong',
      });
      expect(user).toBeNull();
    });

    it('returns null on empty inputs', async () => {
      await seedAdmin();
      expect(await verifyAdminPassword(handle.db as never, { email: '', password: '' })).toBeNull();
    });
  });

  describe('verifyApiKey', () => {
    it('returns key view for a valid plaintext', async () => {
      const k = await seedKey({ scopes: ['sites:read'] });
      const view = await verifyApiKey(handle.db as never, k.plaintext);
      expect(view).toEqual({
        id: k.id,
        name: 'test-key',
        scopes: ['sites:read'],
        rateLimitPerMin: null,
      });
    });

    it('stamps last_used_at on success (best-effort)', async () => {
      const k = await seedKey({});
      await verifyApiKey(handle.db as never, k.plaintext);
      // Give the fire-and-forget update a tick to flush.
      await new Promise((r) => setTimeout(r, 50));
      const [row] = await handle.db.select({ lastUsedAt: apiKeys.lastUsedAt }).from(apiKeys);
      expect(row?.lastUsedAt).toBeInstanceOf(Date);
    });

    it('rejects revoked keys', async () => {
      const k = await seedKey({ revokedAt: new Date() });
      const view = await verifyApiKey(handle.db as never, k.plaintext);
      expect(view).toBeNull();
    });

    it('rejects expired keys', async () => {
      const k = await seedKey({ expiresAt: new Date(Date.now() - 60_000) });
      const view = await verifyApiKey(handle.db as never, k.plaintext);
      expect(view).toBeNull();
    });

    it('accepts not-yet-expired keys', async () => {
      const k = await seedKey({ expiresAt: new Date(Date.now() + 60_000) });
      const view = await verifyApiKey(handle.db as never, k.plaintext);
      expect(view?.id).toBe(k.id);
    });

    it('rejects unknown plaintext', async () => {
      await seedKey({});
      const view = await verifyApiKey(handle.db as never, 'not-a-real-key-zzzzzzzzzzzzz');
      expect(view).toBeNull();
    });

    it('rejects too-short / empty input without DB lookup', async () => {
      expect(await verifyApiKey(handle.db as never, '')).toBeNull();
      expect(await verifyApiKey(handle.db as never, 'abc')).toBeNull();
    });
  });

  describe('checkScopes', () => {
    it('returns true when no scopes are required', () => {
      expect(checkScopes({ scopes: [] }, [])).toBe(true);
      expect(checkScopes({ scopes: [] }, undefined)).toBe(true);
    });

    it('requires every requested scope to be present', () => {
      const key = { scopes: ['sites:read', 'sites:write'] };
      expect(checkScopes(key, ['sites:read'])).toBe(true);
      expect(checkScopes(key, ['sites:read', 'sites:write'])).toBe(true);
      expect(checkScopes(key, ['sites:read', 'errors:write'])).toBe(false);
    });

    it('treats * as a global wildcard', () => {
      expect(checkScopes({ scopes: ['*'] }, ['anything', 'else'])).toBe(true);
    });
  });
});
