import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { apiKeyRepo, apiKeys } from '@siteops/db';
import { createTestDb, type TestDbHandle } from '@siteops/db/testing';
import { API_KEY_MAX_ACTIVE, generateApiKey } from '@siteops/shared';

import { apiKeyService } from '../api-key-service.js';

let handle: TestDbHandle;
const deps = () => ({ db: handle.db as never });

beforeEach(async () => {
  if (!handle) handle = await createTestDb();
  await handle.reset();
});

afterAll(async () => {
  if (handle) await handle.close();
});

describe('apiKeyService.create', () => {
  it('issues a key and returns the plaintext exactly once', async () => {
    const out = await apiKeyService.create(deps(), {
      name: 'fixture',
      scopes: ['errors:write'],
    });
    expect(out.plaintext).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    expect(out.apiKey.id).toBeDefined();
    expect(out.apiKey).not.toHaveProperty('keyHash');
    expect(out.apiKey.scopes).toEqual(['errors:write']);
  });

  it('collapses ["*"] scopes to wildcard only', async () => {
    const out = await apiKeyService.create(deps(), {
      name: 'super',
      scopes: ['*', 'errors:write', 'tasks:read'],
    });
    expect(out.apiKey.scopes).toEqual(['*']);
  });

  it('refuses to create when the active-key cap is hit', async () => {
    // Seed exactly API_KEY_MAX_ACTIVE rows directly.
    for (let i = 0; i < API_KEY_MAX_ACTIVE; i++) {
      const generated = await generateApiKey();
      await handle.db.insert(apiKeys).values({
        name: `fixture-${i}`,
        keyHash: generated.hash,
        keyPrefix: generated.prefix,
        scopes: ['errors:read'],
      });
    }
    await expect(
      apiKeyService.create(deps(), { name: 'overflow', scopes: ['errors:read'] }),
    ).rejects.toMatchObject({ code: 'conflict' });
  });

  it('persists expiresAt when supplied', async () => {
    const future = new Date(Date.now() + 7 * 86_400_000).toISOString();
    const out = await apiKeyService.create(deps(), {
      name: 'short-lived',
      scopes: ['errors:write'],
      expiresAt: future,
    });
    expect(out.apiKey.expiresAt).toBeInstanceOf(Date);
  });
});

describe('apiKeyService.revoke', () => {
  it('stamps revoked_at on a fresh key', async () => {
    const created = await apiKeyService.create(deps(), {
      name: 'revoke-me',
      scopes: ['errors:write'],
    });
    const revoked = await apiKeyService.revoke(deps(), created.apiKey.id);
    expect(revoked.revokedAt).not.toBeNull();
  });

  it('is idempotent on a key that is already revoked', async () => {
    const created = await apiKeyService.create(deps(), {
      name: 'twice',
      scopes: ['errors:write'],
    });
    const first = await apiKeyService.revoke(deps(), created.apiKey.id);
    const second = await apiKeyService.revoke(deps(), created.apiKey.id);
    expect(second.revokedAt?.toISOString()).toBe(first.revokedAt?.toISOString());
  });

  it('throws not_found for an unknown id', async () => {
    await expect(
      apiKeyService.revoke(deps(), '00000000-0000-4000-8000-000000000000'),
    ).rejects.toMatchObject({ code: 'not_found' });
  });
});

describe('apiKeyService.updateRateLimit', () => {
  it('sets the rate_limit_per_min on an active key', async () => {
    const created = await apiKeyService.create(deps(), {
      name: 'rl-target',
      scopes: ['errors:write'],
    });
    expect(created.apiKey.rateLimitPerMin).toBeNull();

    const updated = await apiKeyService.updateRateLimit(deps(), created.apiKey.id, 120);
    expect(updated.rateLimitPerMin).toBe(120);
  });

  it('null clears an existing override', async () => {
    const created = await apiKeyService.create(deps(), {
      name: 'rl-clear',
      scopes: ['errors:write'],
      rateLimitPerMin: 60,
    });
    expect(created.apiKey.rateLimitPerMin).toBe(60);

    const cleared = await apiKeyService.updateRateLimit(deps(), created.apiKey.id, null);
    expect(cleared.rateLimitPerMin).toBeNull();
  });

  it('throws not_found on unknown id', async () => {
    await expect(
      apiKeyService.updateRateLimit(deps(), '00000000-0000-4000-8000-000000000000', 60),
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  it('refuses to update revoked rows (404 surface)', async () => {
    const created = await apiKeyService.create(deps(), {
      name: 'rl-revoked',
      scopes: ['errors:write'],
    });
    await apiKeyService.revoke(deps(), created.apiKey.id);
    await expect(
      apiKeyService.updateRateLimit(deps(), created.apiKey.id, 60),
    ).rejects.toMatchObject({ code: 'not_found' });
  });
});

describe('apiKeyService.list', () => {
  it('hides revoked rows when state="active"', async () => {
    const a = await apiKeyService.create(deps(), {
      name: 'live',
      scopes: ['errors:write'],
    });
    const b = await apiKeyService.create(deps(), {
      name: 'dead',
      scopes: ['errors:write'],
    });
    await apiKeyService.revoke(deps(), b.apiKey.id);

    const active = await apiKeyService.list(deps(), { filters: { state: 'active' } });
    expect(active.items.map((r) => r.id)).toEqual([a.apiKey.id]);

    const revoked = await apiKeyService.list(deps(), { filters: { state: 'revoked' } });
    expect(revoked.items.map((r) => r.id)).toEqual([b.apiKey.id]);
  });

  it('list page omits the key_hash column', async () => {
    await apiKeyService.create(deps(), { name: 'safe', scopes: ['errors:write'] });
    const page = await apiKeyService.list(deps(), {});
    for (const item of page.items) {
      expect(item).not.toHaveProperty('keyHash');
    }
  });
});

describe('apiKeyRepo.countActive (sanity)', () => {
  it('matches list({state:active}).total', async () => {
    await apiKeyService.create(deps(), { name: 'a', scopes: ['errors:write'] });
    const b = await apiKeyService.create(deps(), { name: 'b', scopes: ['errors:write'] });
    await apiKeyService.revoke(deps(), b.apiKey.id);

    const active = await apiKeyService.list(deps(), { filters: { state: 'active' } });
    const count = await apiKeyRepo.countActive(handle.db as never);
    expect(count).toBe(active.total);
  });
});
