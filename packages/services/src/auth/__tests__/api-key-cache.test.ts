/**
 * Unit + integration tests for the API-key cache (T30).
 *
 * Covers:
 *   1. The cache itself (hit / miss / size, invalidateById, expired entry
 *      self-eviction, plaintext isolation).
 *   2. `verifyApiKey` integration: bcrypt is consulted once across N hits
 *      for the same plaintext.
 *   3. `apiKeyService.revoke` integration: subsequent verify returns null
 *      and re-runs bcrypt (cache evicted).
 *
 * `compareApiKey` is module-mocked to expose a call counter without giving
 * up real bcrypt verification (we re-export the actual implementation
 * wrapped by `vi.fn`).
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as SharedModule from '@siteops/shared';

vi.mock('@siteops/shared', async () => {
  const actual = await vi.importActual<typeof SharedModule>('@siteops/shared');
  return {
    ...actual,
    compareApiKey: vi.fn(actual.compareApiKey),
  };
});

import { apiKeys } from '@siteops/db';
import { createTestDb, type TestDbHandle } from '@siteops/db/testing';
import { compareApiKey, generateApiKey } from '@siteops/shared';

import { apiKeyCache, type ApiKeyCacheEntry } from '../api-key-cache.js';
import { apiKeyService } from '../api-key-service.js';
import { type AuthenticatedApiKey, verifyApiKey } from '../auth-service.js';

let handle: TestDbHandle;
const deps = () => ({ db: handle.db as never });
const compareSpy = vi.mocked(compareApiKey);

async function seedKey(opts: {
  scopes?: string[];
  expiresAt?: Date | null;
  revokedAt?: Date | null;
}): Promise<{ id: string; plaintext: string }> {
  const generated = await generateApiKey();
  const [row] = await handle.db
    .insert(apiKeys)
    .values({
      name: 'fixture',
      keyHash: generated.hash,
      keyPrefix: generated.prefix,
      scopes: opts.scopes ?? ['errors:read'],
      expiresAt: opts.expiresAt ?? null,
      revokedAt: opts.revokedAt ?? null,
    })
    .returning({ id: apiKeys.id });
  if (!row) throw new Error('seedKey: insert returned no row');
  return { id: row.id, plaintext: generated.plaintext };
}

beforeEach(async () => {
  if (!handle) handle = await createTestDb();
  await handle.reset();
  apiKeyCache.clear();
  apiKeyCache.resetStats();
  compareSpy.mockClear();
});

afterAll(async () => {
  if (handle) await handle.close();
});

describe('apiKeyCache (unit)', () => {
  function fakeEntry(id: string, expiresAt: Date | null = null): ApiKeyCacheEntry {
    const apiKey: AuthenticatedApiKey = {
      id,
      name: 'fixture',
      scopes: ['errors:read'],
      rateLimitPerMin: null,
    };
    return { apiKey, expiresAt, id };
  }

  it('returns the inserted entry on hit and increments stats.hits', () => {
    apiKeyCache.set('plaintext-aaa', fakeEntry('id-1'));
    const hit = apiKeyCache.get('plaintext-aaa');
    expect(hit?.id).toBe('id-1');
    expect(apiKeyCache.stats()).toMatchObject({ hits: 1, misses: 0, sets: 1 });
  });

  it('returns undefined for plaintext that was never inserted', () => {
    apiKeyCache.set('plaintext-aaa', fakeEntry('id-1'));
    expect(apiKeyCache.get('plaintext-bbb')).toBeUndefined();
    expect(apiKeyCache.stats()).toMatchObject({ hits: 0, misses: 1 });
  });

  it('does not leak between distinct plaintexts (sha256 keying)', () => {
    apiKeyCache.set('plaintext-aaa', fakeEntry('id-aaa'));
    apiKeyCache.set('plaintext-bbb', fakeEntry('id-bbb'));
    expect(apiKeyCache.get('plaintext-aaa')?.id).toBe('id-aaa');
    expect(apiKeyCache.get('plaintext-bbb')?.id).toBe('id-bbb');
    expect(apiKeyCache.size()).toBe(2);
  });

  it('self-evicts when the entry expiresAt is in the past', () => {
    apiKeyCache.set('plaintext-old', fakeEntry('id-old', new Date(Date.now() - 1_000)));
    expect(apiKeyCache.get('plaintext-old')).toBeUndefined();
    expect(apiKeyCache.size()).toBe(0);
    expect(apiKeyCache.stats()).toMatchObject({ hits: 0, misses: 1 });
  });

  it('keeps an entry whose expiresAt is in the future', () => {
    apiKeyCache.set('plaintext-fresh', fakeEntry('id-fresh', new Date(Date.now() + 60_000)));
    expect(apiKeyCache.get('plaintext-fresh')?.id).toBe('id-fresh');
  });

  it('invalidateById removes every entry mapping to that id and counts evictions', () => {
    apiKeyCache.set('plaintext-1', fakeEntry('id-target'));
    apiKeyCache.set('plaintext-2', fakeEntry('id-target'));
    apiKeyCache.set('plaintext-3', fakeEntry('id-other'));
    const evicted = apiKeyCache.invalidateById('id-target');
    expect(evicted).toBe(2);
    expect(apiKeyCache.get('plaintext-1')).toBeUndefined();
    expect(apiKeyCache.get('plaintext-2')).toBeUndefined();
    expect(apiKeyCache.get('plaintext-3')?.id).toBe('id-other');
  });

  it('invalidateById is a no-op for an unknown id', () => {
    apiKeyCache.set('plaintext-x', fakeEntry('id-x'));
    expect(apiKeyCache.invalidateById('id-zzz')).toBe(0);
    expect(apiKeyCache.get('plaintext-x')?.id).toBe('id-x');
  });
});

describe('verifyApiKey + apiKeyCache (integration)', () => {
  it('compareApiKey is called once across 100 verifications of the same plaintext', async () => {
    const k = await seedKey({});
    expect(compareSpy).toHaveBeenCalledTimes(0);

    const first = await verifyApiKey(handle.db as never, k.plaintext);
    expect(first?.id).toBe(k.id);
    expect(compareSpy).toHaveBeenCalledTimes(1);

    for (let i = 0; i < 99; i++) {
      const view = await verifyApiKey(handle.db as never, k.plaintext);
      expect(view?.id).toBe(k.id);
    }

    expect(compareSpy).toHaveBeenCalledTimes(1);
    expect(apiKeyCache.stats()).toMatchObject({ hits: 99, misses: 1, sets: 1 });
  });

  it('does not pollute across distinct plaintexts (each one gets its own bcrypt cycle)', async () => {
    const a = await seedKey({});
    const b = await seedKey({});

    const va = await verifyApiKey(handle.db as never, a.plaintext);
    const vb = await verifyApiKey(handle.db as never, b.plaintext);
    expect(va?.id).toBe(a.id);
    expect(vb?.id).toBe(b.id);

    // One bcrypt per distinct plaintext on the first encounter.
    expect(compareSpy).toHaveBeenCalledTimes(2);

    // Subsequent hits stay on cache.
    await verifyApiKey(handle.db as never, a.plaintext);
    await verifyApiKey(handle.db as never, b.plaintext);
    expect(compareSpy).toHaveBeenCalledTimes(2);
  });

  it('treats a cached entry whose expiresAt is in the past as a miss (falls through to DB)', async () => {
    // Inject a stale entry directly so we don't race bcrypt against a tight
    // wall-clock window. The DB row itself is still valid.
    const k = await seedKey({});
    const apiKey: AuthenticatedApiKey = {
      id: k.id,
      name: 'fixture',
      scopes: ['errors:read'],
      rateLimitPerMin: null,
    };
    apiKeyCache.set(k.plaintext, {
      apiKey,
      expiresAt: new Date(Date.now() - 1),
      id: k.id,
    });
    expect(apiKeyCache.size()).toBe(1);

    const view = await verifyApiKey(handle.db as never, k.plaintext);
    // Cache self-evicts (expired) → DB fallthrough succeeds via real bcrypt.
    expect(view?.id).toBe(k.id);
    expect(compareSpy).toHaveBeenCalledTimes(1);
    // Cache is repopulated with a fresh entry.
    expect(apiKeyCache.size()).toBe(1);
  });
});

describe('apiKeyService.revoke + apiKeyCache (integration)', () => {
  it('warming the cache, then revoking, makes the next verify miss + return null', async () => {
    const created = await apiKeyService.create(deps(), {
      name: 'cached',
      scopes: ['errors:read'],
    });

    // Warm the cache via a successful verify.
    const warm = await verifyApiKey(handle.db as never, created.plaintext);
    expect(warm?.id).toBe(created.apiKey.id);
    expect(compareSpy).toHaveBeenCalledTimes(1);
    expect(apiKeyCache.size()).toBe(1);

    // Revoke evicts the cached entry on the same replica.
    await apiKeyService.revoke(deps(), created.apiKey.id);
    expect(apiKeyCache.size()).toBe(0);

    // Subsequent verify must hit the DB, see revoked_at, and return null.
    const after = await verifyApiKey(handle.db as never, created.plaintext);
    expect(after).toBeNull();
    // The DB lookup filters by `revoked_at IS NULL`, so we never bcrypt
    // a revoked row — the call count stays at 1.
    expect(compareSpy).toHaveBeenCalledTimes(1);
  });
});
