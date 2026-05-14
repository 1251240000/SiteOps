import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { siteRepo, uptimeRepo } from '@siteops/db';
import { createTestDb, type TestDbHandle } from '@siteops/db/testing';

import { uptimeService } from '../uptime-service.js';

let handle: TestDbHandle;
const deps = () => ({ db: handle.db as never });

async function seedSite(): Promise<string> {
  const created = await siteRepo.create(handle.db as never, {
    slug: `s-${Math.random().toString(36).slice(2, 8)}`,
    name: 'Test',
    primaryUrl: 'https://example.com',
    siteType: 'tool',
  });
  return created.id;
}

describe('uptimeService.probeUrl', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects loopback / private hosts with ssrf_blocked:* error', async () => {
    for (const url of ['http://127.0.0.1', 'http://localhost', 'http://10.0.0.1']) {
      const res = await uptimeService.probeUrl(url);
      expect(res.ok).toBe(false);
      expect(res.error ?? '').toMatch(/^ssrf_blocked:/);
      expect(res.statusCode).toBeNull();
    }
  });

  it('treats 2xx + 3xx as ok by default', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response('ok', { status: 200, headers: { 'content-type': 'text/plain' } }),
      );
    const res = await uptimeService.probeUrl('https://example.com');
    expect(fetchSpy).toHaveBeenCalled();
    expect(res.ok).toBe(true);
    expect(res.statusCode).toBe(200);
    expect(res.error).toBeNull();
  });

  it('treats 5xx as failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('boom', { status: 503 }));
    const res = await uptimeService.probeUrl('https://example.com');
    expect(res.ok).toBe(false);
    expect(res.statusCode).toBe(503);
  });

  it('reports network errors as ok=false / statusCode=null', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('econnrefused'));
    const res = await uptimeService.probeUrl('https://example.com');
    expect(res.ok).toBe(false);
    expect(res.statusCode).toBeNull();
    expect(res.error).toBe('econnrefused');
  });
});

describe('uptimeService.checkAndRecord', () => {
  beforeEach(async () => {
    if (!handle) handle = await createTestDb();
    await handle.reset();
  });

  afterAll(async () => {
    if (handle) await handle.close();
  });

  it('persists a row and updates health score from 100 → 100 when fully healthy', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 200 }));
    const siteId = await seedSite();
    const res = await uptimeService.checkAndRecord(deps(), siteId);
    expect(res.check.ok).toBe(true);
    expect(res.newHealthScore).toBe(100);
    const rows = await uptimeRepo.listRecent(handle.db as never, siteId);
    expect(rows).toHaveLength(1);
  });

  it('drops health score when a failure is recorded', async () => {
    const siteId = await seedSite();
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('', { status: 200 }))
      .mockResolvedValueOnce(new Response('', { status: 500 }))
      .mockResolvedValueOnce(new Response('', { status: 500 }));
    await uptimeService.checkAndRecord(deps(), siteId); // ok
    await uptimeService.checkAndRecord(deps(), siteId); // fail
    const last = await uptimeService.checkAndRecord(deps(), siteId); // fail
    // 1/3 ok ≈ 33
    expect(last.newHealthScore).toBeLessThan(100);
    expect(last.consecutiveFailures).toBe(2);
  });
});
