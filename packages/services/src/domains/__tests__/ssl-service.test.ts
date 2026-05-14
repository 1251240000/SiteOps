import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { domainRepo, siteRepo } from '@siteops/db';
import { createTestDb, type TestDbHandle } from '@siteops/db/testing';

import {
  daysUntilSsl,
  defaultSslProbe,
  SSL_ALERT_THRESHOLD_DAYS,
  sslService,
  type SslProbeResult,
} from '../ssl-service.js';

let handle: TestDbHandle;
const deps = () => ({ db: handle.db as never });

async function seedDomain(domain: string, opts: { expiresAt?: string } = {}): Promise<string> {
  const site = await siteRepo.create(handle.db as never, {
    slug: `s-${Math.random().toString(36).slice(2, 8)}`,
    name: domain,
    primaryUrl: `https://${domain}`,
    siteType: 'tool',
  });
  const d = await domainRepo.create(handle.db as never, {
    siteId: site.id,
    domain,
    isPrimary: true,
    ...(opts.expiresAt ? { expiresAt: opts.expiresAt } : {}),
  });
  return d.id;
}

describe('sslService', () => {
  beforeEach(async () => {
    if (!handle) handle = await createTestDb();
    await handle.reset();
  });

  afterAll(async () => {
    if (handle) await handle.close();
  });

  it('persists valid_to + issuer when probe succeeds', async () => {
    const id = await seedDomain('example.com');
    const validTo = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000);
    const probe = async (): Promise<SslProbeResult> => ({
      domain: 'example.com',
      ok: true,
      validTo,
      issuer: "Let's Encrypt",
      error: null,
    });
    const row = (await domainRepo.getById(handle.db as never, id))!;
    const { domain: updated, daysUntilSslExpiry } = await sslService.probeAndStore(
      { ...deps(), probe },
      row,
    );
    expect(updated.sslIssuer).toBe("Let's Encrypt");
    expect(updated.sslExpiresAt?.getTime()).toBe(validTo.getTime());
    expect(daysUntilSslExpiry).toBeGreaterThan(50);
  });

  it('clears SSL data when probe fails', async () => {
    const id = await seedDomain('expired.example');
    const probe = async (): Promise<SslProbeResult> => ({
      domain: 'expired.example',
      ok: false,
      validTo: null,
      issuer: null,
      error: 'no_certificate',
    });
    const row = (await domainRepo.getById(handle.db as never, id))!;
    const { domain: updated } = await sslService.probeAndStore({ ...deps(), probe }, row);
    expect(updated.sslExpiresAt).toBeNull();
    expect(updated.sslIssuer).toBeNull();
  });

  it('returns findings under threshold via runAll', async () => {
    await seedDomain('soon.example');
    const probe = async (): Promise<SslProbeResult> => ({
      domain: 'soon.example',
      ok: true,
      validTo: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
      issuer: 'TestCA',
      error: null,
    });
    const res = await sslService.runAll({ ...deps(), probe });
    expect(res.probed).toBe(1);
    const sslFinding = res.findings.find((f) => f.type === 'ssl');
    expect(sslFinding).toBeDefined();
    expect(sslFinding!.thresholdDays).toBe(SSL_ALERT_THRESHOLD_DAYS);
  });
});

describe('daysUntilSsl', () => {
  it('returns null for null/invalid', () => {
    expect(daysUntilSsl(null)).toBeNull();
    expect(daysUntilSsl('not a date')).toBeNull();
  });
  it('returns positive for future, negative for past', () => {
    expect(daysUntilSsl(new Date(Date.now() + 86400000))).toBeGreaterThan(0);
    expect(daysUntilSsl(new Date(Date.now() - 86400000))).toBeLessThan(0);
  });
});

describe('defaultSslProbe', () => {
  // Smoke-only — the real probe needs the network; we just assert the
  // function returns a result shape (timeout will fire in offline envs).
  it('returns a SslProbeResult shape', async () => {
    const res = await defaultSslProbe('invalid-host-for-probe-test.invalid');
    expect(res).toHaveProperty('ok');
    expect(res).toHaveProperty('domain');
    expect(res).toHaveProperty('validTo');
  }, 15_000);
});
