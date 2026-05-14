import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { domainRepo, domains, sites } from '@siteops/db';
import { createTestDb, type TestDbHandle } from '@siteops/db/testing';
import { AppError } from '@siteops/shared';

import { daysUntil, domainService } from '../domain-service.js';

let handle: TestDbHandle;
const deps = () => ({ db: handle.db as never });

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

function iso(offsetDays: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

describe('domainService', () => {
  beforeEach(async () => {
    if (!handle) handle = await createTestDb();
    await handle.reset();
  });

  afterAll(async () => {
    if (handle) await handle.close();
  });

  describe('daysUntil', () => {
    it('returns null for null/undefined', () => {
      expect(daysUntil(null)).toBeNull();
      expect(daysUntil(undefined)).toBeNull();
    });
    it('returns 0 for today', () => {
      expect(daysUntil(new Date())).toBe(0);
    });
    it('returns positive count for future dates', () => {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() + 7);
      expect(daysUntil(d)).toBe(7);
    });
    it('returns negative count for past dates', () => {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() - 3);
      expect(daysUntil(d)).toBe(-3);
    });
    it('parses ISO-only date strings as UTC midnight', () => {
      expect(daysUntil('1970-01-02')).toBeLessThan(0);
    });
  });

  describe('create', () => {
    it('normalises the domain and rejects duplicates', async () => {
      const siteId = await seedSite('site');
      const out = await domainService.create(deps(), {
        siteId,
        domain: 'HTTPS://Example.COM/some/path',
        isPrimary: false,
      });
      expect(out.domain).toBe('example.com');

      let err: unknown;
      try {
        await domainService.create(deps(), {
          siteId,
          domain: '  example.com  ',
          isPrimary: false,
        });
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).code).toBe('conflict');
    });

    it('rejects invalid domains with validation_failed', async () => {
      const siteId = await seedSite('site');
      let err: unknown;
      try {
        await domainService.create(deps(), {
          siteId,
          domain: 'localhost',
          isPrimary: false,
        });
      } catch (e) {
        err = e;
      }
      expect((err as AppError).code).toBe('validation_failed');
    });

    it('promotes to primary transactionally, demoting any prior primary', async () => {
      const siteId = await seedSite('site');
      const initial = await domainService.create(deps(), {
        siteId,
        domain: 'first.example.com',
        isPrimary: true,
      });
      const second = await domainService.create(deps(), {
        siteId,
        domain: 'second.example.com',
        isPrimary: true,
      });
      expect(initial.isPrimary).toBe(true);
      expect(second.isPrimary).toBe(true);

      // Only one row may remain primary.
      expect(await domainRepo.countPrimary(handle.db as never, siteId)).toBe(1);
      const list = await handle.db.select().from(domains);
      const primaries = list.filter((d) => d.isPrimary).map((d) => d.domain);
      expect(primaries).toEqual(['second.example.com']);
    });

    it('returns computed daysUntilDomainExpiry on the view', async () => {
      const siteId = await seedSite('site');
      const out = await domainService.create(deps(), {
        siteId,
        domain: 'soon.example.com',
        isPrimary: false,
        expiresAt: iso(10),
      });
      expect(out.daysUntilDomainExpiry).toBe(10);
    });
  });

  describe('update', () => {
    it('promoting a non-primary clears the old primary atomically', async () => {
      const siteId = await seedSite('site');
      const first = await domainService.create(deps(), {
        siteId,
        domain: 'first.example.com',
        isPrimary: true,
      });
      const second = await domainService.create(deps(), {
        siteId,
        domain: 'second.example.com',
        isPrimary: false,
      });
      await domainService.update(deps(), second.id, { isPrimary: true });
      expect(await domainRepo.countPrimary(handle.db as never, siteId)).toBe(1);
      const refreshed = await domainRepo.getById(handle.db as never, first.id);
      expect(refreshed?.isPrimary).toBe(false);
    });

    it('demoting a primary is allowed', async () => {
      const siteId = await seedSite('site');
      const d = await domainService.create(deps(), {
        siteId,
        domain: 'only.example.com',
        isPrimary: true,
      });
      const out = await domainService.update(deps(), d.id, { isPrimary: false });
      expect(out.isPrimary).toBe(false);
      expect(await domainRepo.countPrimary(handle.db as never, siteId)).toBe(0);
    });

    it('rename + uniqueness check', async () => {
      const siteId = await seedSite('site');
      const a = await domainService.create(deps(), {
        siteId,
        domain: 'old.example.com',
        isPrimary: false,
      });
      await domainService.create(deps(), {
        siteId,
        domain: 'taken.example.com',
        isPrimary: false,
      });

      // Rename to a fresh one — succeeds.
      const out = await domainService.update(deps(), a.id, { domain: 'NEW.example.com' });
      expect(out.domain).toBe('new.example.com');

      // Rename to an existing one — conflict.
      let err: unknown;
      try {
        await domainService.update(deps(), a.id, { domain: 'taken.example.com' });
      } catch (e) {
        err = e;
      }
      expect((err as AppError).code).toBe('conflict');
    });
  });

  describe('setPrimary', () => {
    it('promotes within a site', async () => {
      const siteId = await seedSite('site');
      const a = await domainService.create(deps(), {
        siteId,
        domain: 'a.example.com',
        isPrimary: true,
      });
      const b = await domainService.create(deps(), {
        siteId,
        domain: 'b.example.com',
        isPrimary: false,
      });
      const out = await domainService.setPrimary(deps(), siteId, b.id);
      expect(out.isPrimary).toBe(true);
      const refreshedA = await domainRepo.getById(handle.db as never, a.id);
      expect(refreshedA?.isPrimary).toBe(false);
    });

    it('throws 404 when the domain belongs to another site', async () => {
      const a = await seedSite('a');
      const b = await seedSite('b');
      const da = await domainService.create(deps(), {
        siteId: a,
        domain: 'a.example.com',
        isPrimary: true,
      });
      let err: unknown;
      try {
        await domainService.setPrimary(deps(), b, da.id);
      } catch (e) {
        err = e;
      }
      expect((err as AppError).status).toBe(404);
    });
  });

  describe('attachPrimary', () => {
    it('is idempotent for the same site (no duplicate row)', async () => {
      const siteId = await seedSite('site');
      const a = await domainService.attachPrimary(deps(), siteId, 'site.example.com');
      const b = await domainService.attachPrimary(deps(), siteId, 'site.example.com');
      expect(a?.id).toBe(b?.id);
      const all = await handle.db.select().from(domains);
      expect(all).toHaveLength(1);
    });

    it('promotes an existing non-primary row instead of erroring', async () => {
      const siteId = await seedSite('site');
      await domainService.create(deps(), {
        siteId,
        domain: 'site.example.com',
        isPrimary: false,
      });
      const out = await domainService.attachPrimary(deps(), siteId, 'site.example.com');
      expect(out?.isPrimary).toBe(true);
    });

    it('returns null when the domain is already owned by another site', async () => {
      const a = await seedSite('a');
      const b = await seedSite('b');
      await domainService.create(deps(), {
        siteId: a,
        domain: 'shared.example.com',
        isPrimary: true,
      });
      const events: Array<{ obj: Record<string, unknown> }> = [];
      const logger = {
        info: () => {},
        warn: (obj: Record<string, unknown>) => events.push({ obj }),
      };
      const out = await domainService.attachPrimary(
        { db: handle.db as never, logger },
        b,
        'shared.example.com',
      );
      expect(out).toBeNull();
      expect(events.some((e) => e.obj['event'] === 'domain.attach_skipped')).toBe(true);
    });
  });

  describe('remove', () => {
    it('deletes and surfaces the deleted row', async () => {
      const siteId = await seedSite('site');
      const d = await domainService.create(deps(), {
        siteId,
        domain: 'bye.example.com',
        isPrimary: false,
      });
      const out = await domainService.remove(deps(), d.id);
      expect(out.id).toBe(d.id);
      expect(await domainRepo.getById(handle.db as never, d.id)).toBeNull();
    });
  });
});
