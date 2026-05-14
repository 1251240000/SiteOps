import { describe, expect, it } from 'vitest';

import { AdSenseClient, AdSenseError, type AdSenseFetch } from './client.js';
import { parseAdSenseReport, toUsd } from './mapper.js';

function mock(
  handler: (input: string, init?: RequestInit) => Response | Promise<Response>,
): AdSenseFetch {
  return (input, init) => Promise.resolve(handler(input, init));
}

describe('AdSenseClient.generateReport', () => {
  it('builds the request URL with date params and metrics', async () => {
    let calledUrl: string | null = null;
    const client = new AdSenseClient({
      accessToken: 'tk',
      fetch: mock((url) => {
        calledUrl = String(url);
        return new Response(
          JSON.stringify({
            headers: [
              { name: 'DATE' },
              { name: 'DOMAIN_NAME' },
              { name: 'ESTIMATED_EARNINGS', currencyCode: 'USD' },
            ],
            rows: [],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }),
    });
    await client.generateReport('accounts/pub-1', {
      startDate: { year: 2026, month: 1, day: 1 },
      endDate: { year: 2026, month: 1, day: 1 },
      metrics: ['ESTIMATED_EARNINGS'],
      dimensions: ['DATE', 'DOMAIN_NAME'],
      currencyCode: 'USD',
    });
    expect(calledUrl).toContain('/accounts/pub-1/reports:generate');
    expect(calledUrl).toContain('startDate.year=2026');
    expect(calledUrl).toContain('dimensions=DATE');
    expect(calledUrl).toContain('metrics=ESTIMATED_EARNINGS');
  });

  it('surfaces 403 as forbidden', async () => {
    const client = new AdSenseClient({
      accessToken: 'tk',
      fetch: mock(
        () =>
          new Response(JSON.stringify({ error: { message: 'forbidden', code: 403 } }), {
            status: 403,
            headers: { 'content-type': 'application/json' },
          }),
      ),
    });
    let caught: unknown;
    try {
      await client.generateReport('accounts/pub-1', {
        startDate: { year: 2026, month: 1, day: 1 },
        endDate: { year: 2026, month: 1, day: 1 },
        metrics: ['ESTIMATED_EARNINGS'],
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(AdSenseError);
    expect((caught as AdSenseError).code).toBe('forbidden');
  });
});

describe('parseAdSenseReport', () => {
  it('extracts date/domain/earnings/impressions/clicks', () => {
    const rows = parseAdSenseReport({
      headers: [
        { name: 'DATE' },
        { name: 'DOMAIN_NAME' },
        { name: 'ESTIMATED_EARNINGS', currencyCode: 'USD' },
        { name: 'PAGE_VIEWS' },
        { name: 'IMPRESSIONS' },
        { name: 'CLICKS' },
        { name: 'PAGE_VIEWS_RPM' },
        { name: 'IMPRESSIONS_CTR' },
      ],
      rows: [
        {
          cells: [
            { value: '2026-01-01' },
            { value: 'example.com' },
            { value: '1.2345' },
            { value: '100' },
            { value: '90' },
            { value: '4' },
            { value: '0.45' },
            { value: '0.044' },
          ],
        },
        {
          cells: [
            { value: 'not-a-date' },
            { value: 'x' },
            { value: '0' },
            { value: '0' },
            { value: '0' },
            { value: '0' },
            { value: '0' },
            { value: '0' },
          ],
        },
      ],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.domain).toBe('example.com');
    expect(rows[0]?.earnings).toBeCloseTo(1.2345);
    expect(rows[0]?.pageViews).toBe(100);
    expect(rows[0]?.currencyCode).toBe('USD');
  });
});

describe('toUsd', () => {
  it('returns the same value for USD', () => {
    expect(toUsd(10, 'USD')).toBe(10);
  });
  it('converts EUR roughly to USD', () => {
    expect(toUsd(10, 'EUR')).toBeCloseTo(10.8, 1);
  });
  it('treats unknown currencies as USD (no conversion)', () => {
    expect(toUsd(10, 'XYZ')).toBe(10);
  });
});
