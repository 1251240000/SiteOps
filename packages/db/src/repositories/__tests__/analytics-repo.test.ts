import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { analyticsEvents, sites } from '../../schema/index.js';
import { createTestDb, type TestDbHandle } from '../../testing.js';
import { analyticsRepo } from '../analytics-repo.js';

let handle: TestDbHandle;

async function seedSite(): Promise<{ id: string; key: string }> {
  const [row] = await handle.db
    .insert(sites)
    .values({
      slug: 'analytics-site',
      name: 'Analytics Site',
      primaryUrl: 'https://example.com',
      siteType: 'tool',
    })
    .returning({ id: sites.id, key: sites.publicAnalyticsKey });
  if (!row) throw new Error('seed failed');
  return row;
}

describe('analyticsRepo', () => {
  beforeEach(async () => {
    if (!handle) handle = await createTestDb();
    await handle.reset();
  });
  afterAll(async () => {
    if (handle) await handle.close();
  });

  it('resolves site by public analytics key and deduplicates events by hash', async () => {
    const site = await seedSite();
    expect((await analyticsRepo.findSiteByPublicKey(handle.db as never, site.key))?.id).toBe(
      site.id,
    );

    const event = {
      siteId: site.id,
      visitorId: 'v1',
      sessionId: 's1',
      type: 'event' as const,
      name: 'cta_click',
      eventHash: 'hash1',
      occurredAt: new Date('2026-01-01T00:00:00Z'),
      path: null,
      url: null,
      referrer: null,
      properties: { plan: 'pro' },
    };
    expect(await analyticsRepo.insertEvents(handle.db as never, [event, event])).toBe(1);
    const rows = await handle.db.select().from(analyticsEvents);
    expect(rows).toHaveLength(1);
  });
});
