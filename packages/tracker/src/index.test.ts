import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createTracker } from './index.js';

describe('createTracker', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-02T03:04:05.000Z'));
  });

  it('auto-enqueues a pageview and flushes it as a collect payload', async () => {
    const sent: unknown[] = [];
    const tracker = createTracker({
      siteKey: 'site_pk_test',
      endpoint: 'https://ops.example.com/api/v1/collect',
      autoPageview: true,
      batchSize: 10,
      flushIntervalMs: 60_000,
      transport: async (payload) => {
        sent.push(payload);
      },
      location: {
        href: 'https://example.com/docs?utm_source=newsletter&utm_campaign=launch',
        pathname: '/docs',
        search: '?utm_source=newsletter&utm_campaign=launch',
      },
      document: { title: 'Docs', referrer: 'https://google.com/search?q=siteops' },
      navigator: { language: 'en-US', userAgent: 'Mozilla/5.0 Test', sendBeacon: vi.fn() },
      screen: { width: 1440, height: 900 },
      storage: new Map<string, string>(),
      sessionStorage: new Map<string, string>(),
      idFactory: () => 'fixed-id',
    });

    await tracker.flush();

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      siteKey: 'site_pk_test',
      visitorId: 'v_fixed-id',
      sessionId: 's_fixed-id',
      events: [
        {
          type: 'pageview',
          name: 'pageview',
          path: '/docs',
          url: 'https://example.com/docs?utm_source=newsletter&utm_campaign=launch',
          referrer: 'https://google.com/search?q=siteops',
          properties: {
            title: 'Docs',
            utm: { source: 'newsletter', campaign: 'launch' },
          },
        },
      ],
    });
  });

  it('drops oversized properties and caps a batch at 50 events', async () => {
    const sent: Array<{ events: unknown[] }> = [];
    const tracker = createTracker({
      siteKey: 'site_pk_test',
      endpoint: '/collect',
      autoPageview: false,
      batchSize: 100,
      transport: async (payload) => {
        sent.push(payload as { events: unknown[] });
      },
      storage: new Map<string, string>(),
      sessionStorage: new Map<string, string>(),
      idFactory: () => 'id',
    });

    tracker.track('too_big', { blob: 'x'.repeat(9 * 1024) });
    for (let i = 0; i < 60; i++) tracker.track('click', { i });
    await tracker.flush();

    expect(sent).toHaveLength(2);
    expect(sent.every((payload) => payload.events.length <= 50)).toBe(true);
    expect(sent.flatMap((payload) => payload.events)).toHaveLength(60);
    expect(sent.flatMap((payload) => payload.events)).not.toContainEqual(
      expect.objectContaining({ name: 'too_big' }),
    );
  });

  it('collects device metadata on pageview and reports Web Vitals', async () => {
    const sent: Array<{
      events: Array<{ type: string; name: string; properties?: Record<string, unknown> }>;
    }> = [];
    let reportMetric:
      | ((metric: { name: 'LCP'; value: number; rating: 'good'; id: string }) => void)
      | undefined;
    const tracker = createTracker({
      siteKey: 'site_pk_test',
      endpoint: '/collect',
      autoPageview: true,
      autoWebVitals: true,
      batchSize: 10,
      flushIntervalMs: 0,
      transport: async (payload) => {
        sent.push(
          payload as {
            events: Array<{ type: string; name: string; properties?: Record<string, unknown> }>;
          },
        );
      },
      location: { href: 'https://example.com/docs', pathname: '/docs', search: '' },
      document: { title: 'Docs', referrer: '' },
      navigator: { language: 'en-US', userAgent: 'Mozilla/5.0 Test', sendBeacon: vi.fn() },
      screen: { width: 1440, height: 900 },
      storage: new Map<string, string>(),
      sessionStorage: new Map<string, string>(),
      idFactory: () => 'fixed-id',
      webVitalsReporter: (callback) => {
        reportMetric = callback as typeof reportMetric;
      },
    });

    reportMetric?.({ name: 'LCP', value: 1234, rating: 'good', id: 'v1' });
    await tracker.flush();

    expect(sent).toHaveLength(1);
    expect(sent[0]?.events).toEqual([
      expect.objectContaining({
        type: 'pageview',
        properties: expect.objectContaining({
          device: expect.objectContaining({
            language: 'en-US',
            screen: { width: 1440, height: 900 },
          }),
        }),
      }),
      expect.objectContaining({
        type: 'web_vital',
        name: 'LCP',
        properties: { value: 1234, rating: 'good', id: 'v1' },
      }),
    ]);
  });
});
