import { describe, expect, it } from 'vitest';

import { collectPayloadSchema } from './analytics.js';

describe('collectPayloadSchema', () => {
  const base = {
    siteKey: 'site_pk_abc123',
    sentAt: '2026-01-02T03:04:05.000Z',
    visitorId: 'v_123',
    sessionId: 's_123',
    events: [
      {
        type: 'event',
        name: 'cta_click',
        ts: '2026-01-02T03:04:05.000Z',
        properties: { plan: 'pro' },
      },
    ],
  };

  it('accepts valid collect payloads', () => {
    expect(collectPayloadSchema.parse(base).events[0]?.name).toBe('cta_click');
  });

  it('rejects PII-like property keys and oversized batches', () => {
    expect(() =>
      collectPayloadSchema.parse({
        ...base,
        events: [{ ...base.events[0], properties: { email: 'a@example.com' } }],
      }),
    ).toThrow(/PII/);
    expect(() =>
      collectPayloadSchema.parse({
        ...base,
        events: Array.from({ length: 51 }, (_, i) => ({ ...base.events[0], name: `e${i}` })),
      }),
    ).toThrow();
  });
});
