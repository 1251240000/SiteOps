import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createTestDb, type TestDbHandle } from '../../testing.js';
import { domains } from '../../schema/domains.js';
import { sites } from '../../schema/sites.js';
import { domainRepo } from '../domain-repo.js';

let handle: TestDbHandle;

async function seedSite(slug: string): Promise<string> {
  const [row] = await handle.db
    .insert(sites)
    .values({
      slug,
      name: slug,
      primaryUrl: `https://${slug}.example.com`,
      siteType: 'tool',
    })
    .returning({ id: sites.id });
  if (!row) throw new Error('seedSite');
  return row.id;
}

async function seedDomain(
  siteId: string,
  domain: string,
  overrides: Partial<typeof domains.$inferInsert> = {},
): Promise<string> {
  const [row] = await handle.db
    .insert(domains)
    .values({ siteId, domain, ...overrides })
    .returning({ id: domains.id });
  if (!row) throw new Error('seedDomain');
  return row.id;
}

function isoDate(offsetDays: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

describe('domainRepo', () => {
  beforeEach(async () => {
    if (!handle) handle = await createTestDb();
    await handle.reset();
  });

  afterAll(async () => {
    if (handle) await handle.close();
  });

  describe('list', () => {
    it('orders by expires_at ascending by default', async () => {
      const siteId = await seedSite('site');
      await seedDomain(siteId, 'far.example.com', { expiresAt: isoDate(120) });
      await seedDomain(siteId, 'near.example.com', { expiresAt: isoDate(10) });
      await seedDomain(siteId, 'mid.example.com', { expiresAt: isoDate(60) });
      const page = await domainRepo.list(handle.db as never);
      expect(page.items.map((r) => r.domain)).toEqual([
        'near.example.com',
        'mid.example.com',
        'far.example.com',
      ]);
      expect(page.total).toBe(3);
    });

    it('filters by siteId', async () => {
      const a = await seedSite('a');
      const b = await seedSite('b');
      await seedDomain(a, 'a1.example.com');
      await seedDomain(a, 'a2.example.com');
      await seedDomain(b, 'b1.example.com');
      const onlyA = await domainRepo.list(handle.db as never, { filters: { siteId: a } });
      expect(onlyA.items.map((r) => r.domain).sort()).toEqual(['a1.example.com', 'a2.example.com']);
    });

    it('q matches domain or registrar via ILIKE', async () => {
      const siteId = await seedSite('site');
      await seedDomain(siteId, 'docs.example.com', { registrar: 'GoDaddy' });
      await seedDomain(siteId, 'app.example.com', { registrar: 'Cloudflare' });
      const r = await domainRepo.list(handle.db as never, { filters: { q: 'cloudflare' } });
      expect(r.items.map((d) => d.domain)).toEqual(['app.example.com']);
    });

    it('expiringWithinDays returns only rows with date <= today + N', async () => {
      const siteId = await seedSite('site');
      await seedDomain(siteId, 'soon.example.com', { expiresAt: isoDate(5) });
      await seedDomain(siteId, 'late.example.com', { expiresAt: isoDate(120) });
      await seedDomain(siteId, 'null.example.com'); // expires_at NULL → excluded
      const r = await domainRepo.list(handle.db as never, {
        filters: { expiringWithinDays: 30 },
      });
      expect(r.items.map((d) => d.domain)).toEqual(['soon.example.com']);
    });

    it('pagination respects page + limit', async () => {
      const siteId = await seedSite('site');
      for (let i = 0; i < 5; i++) await seedDomain(siteId, `d${i}.example.com`);
      const p1 = await domainRepo.list(handle.db as never, { page: 1, limit: 2 });
      const p2 = await domainRepo.list(handle.db as never, { page: 2, limit: 2 });
      expect(p1.items).toHaveLength(2);
      expect(p2.items).toHaveLength(2);
      expect(p1.total).toBe(5);
    });
  });

  describe('listForSite', () => {
    it('returns site domains, primary first then alpha', async () => {
      const siteId = await seedSite('site');
      await seedDomain(siteId, 'z.example.com');
      await seedDomain(siteId, 'a.example.com');
      await seedDomain(siteId, 'b.example.com', { isPrimary: true });
      const list = await domainRepo.listForSite(handle.db as never, siteId);
      expect(list.map((d) => d.domain)).toEqual([
        'b.example.com',
        'a.example.com',
        'z.example.com',
      ]);
    });
  });

  describe('CRUD', () => {
    it('create + get round-trip', async () => {
      const siteId = await seedSite('site');
      const created = await domainRepo.create(handle.db as never, {
        siteId,
        domain: 'fresh.example.com',
        registrar: 'GoDaddy',
        expiresAt: '2027-01-01',
      });
      expect(created.domain).toBe('fresh.example.com');
      const fetched = await domainRepo.getById(handle.db as never, created.id);
      expect(fetched?.id).toBe(created.id);
      const byName = await domainRepo.getByDomain(handle.db as never, 'fresh.example.com');
      expect(byName?.id).toBe(created.id);
    });

    it('update patches mutable fields', async () => {
      const siteId = await seedSite('site');
      const id = await seedDomain(siteId, 'edit.example.com');
      const out = await domainRepo.update(handle.db as never, id, {
        registrar: 'Cloudflare',
        expiresAt: '2027-06-01',
      });
      expect(out?.registrar).toBe('Cloudflare');
      expect(out?.expiresAt).toBe('2027-06-01');
    });

    it('delete returns the deleted row', async () => {
      const siteId = await seedSite('site');
      const id = await seedDomain(siteId, 'gone.example.com');
      const out = await domainRepo.delete(handle.db as never, id);
      expect(out?.id).toBe(id);
      expect(await domainRepo.getById(handle.db as never, id)).toBeNull();
    });
  });

  describe('setPrimary', () => {
    it('clears the old primary and promotes the new one atomically', async () => {
      const siteId = await seedSite('site');
      const a = await seedDomain(siteId, 'a.example.com', { isPrimary: true });
      const b = await seedDomain(siteId, 'b.example.com');
      const c = await seedDomain(siteId, 'c.example.com');
      const out = await domainRepo.setPrimary(handle.db as never, siteId, b);
      expect(out?.id).toBe(b);
      expect(out?.isPrimary).toBe(true);

      const list = await domainRepo.listForSite(handle.db as never, siteId);
      const primaries = list.filter((r) => r.isPrimary).map((r) => r.id);
      expect(primaries).toEqual([b]);
      expect(list.find((r) => r.id === a)?.isPrimary).toBe(false);
      expect(list.find((r) => r.id === c)?.isPrimary).toBe(false);
      expect(await domainRepo.countPrimary(handle.db as never, siteId)).toBe(1);
    });

    it('refuses to promote a domain that belongs to a different site', async () => {
      const a = await seedSite('a');
      const b = await seedSite('b');
      const aliceDomain = await seedDomain(a, 'alice.example.com');
      const out = await domainRepo.setPrimary(handle.db as never, b, aliceDomain);
      expect(out).toBeNull();
    });
  });

  describe('listForSites', () => {
    it('returns nothing for empty input', async () => {
      expect(await domainRepo.listForSites(handle.db as never, [])).toEqual([]);
    });
    it('returns rows for the given site ids', async () => {
      const a = await seedSite('a');
      const b = await seedSite('b');
      await seedDomain(a, 'a1.example.com');
      await seedDomain(b, 'b1.example.com');
      const out = await domainRepo.listForSites(handle.db as never, [a, b]);
      expect(out.map((d) => d.domain).sort()).toEqual(['a1.example.com', 'b1.example.com']);
    });
  });
});
