import { describe, expect, it } from 'vitest';

import { PlausibleClient, PlausibleError, type PlausibleFetch } from './client.js';

function mock(
  handler: (input: string, init?: RequestInit) => Response | Promise<Response>,
): PlausibleFetch {
  return (input, init) => Promise.resolve(handler(input, init));
}

describe('PlausibleClient.timeseries', () => {
  it('parses a results array', async () => {
    const client = new PlausibleClient({
      apiKey: 'k',
      fetch: mock(
        () =>
          new Response(
            JSON.stringify({
              results: [
                {
                  date: '2026-01-01',
                  pageviews: 100,
                  visitors: 80,
                  visits: 90,
                  bounce_rate: 0.4,
                  visit_duration: 120,
                },
              ],
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
      ),
    });
    const days = await client.timeseries('example.com', {
      start: '2026-01-01',
      end: '2026-01-01',
    });
    expect(days).toHaveLength(1);
    expect(days[0]?.pageviews).toBe(100);
  });

  it('throws PlausibleError on 401', async () => {
    const client = new PlausibleClient({
      apiKey: 'k',
      fetch: mock(
        () =>
          new Response(JSON.stringify({ error: 'unauthorized' }), {
            status: 401,
            headers: { 'content-type': 'application/json' },
          }),
      ),
    });
    await expect(
      client.timeseries('s', { start: '2026-01-01', end: '2026-01-01' }),
    ).rejects.toBeInstanceOf(PlausibleError);
  });
});
