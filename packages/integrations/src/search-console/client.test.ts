import { describe, expect, it } from 'vitest';

import { SearchConsoleClient, GscError, type GscFetch } from './client.js';
import { buildAuthUrl, exchangeCode, refreshAccessToken, OAUTH_TOKEN_URL } from './oauth.js';

function mock(
  handler: (input: string, init?: RequestInit) => Response | Promise<Response>,
): GscFetch {
  return (input, init) => Promise.resolve(handler(input, init));
}

describe('buildAuthUrl', () => {
  it('builds a consent URL with offline access', () => {
    const url = buildAuthUrl(
      { clientId: 'cid', clientSecret: 'csec', redirectUri: 'https://app/callback' },
      { scope: 'https://www.googleapis.com/auth/webmasters.readonly', state: 'st' },
    );
    expect(url).toContain('client_id=cid');
    expect(url).toContain('access_type=offline');
    expect(url).toContain('state=st');
    expect(url).toContain('prompt=consent');
  });
});

describe('exchangeCode + refreshAccessToken', () => {
  it('POSTs grant_type=authorization_code with the code', async () => {
    let received: URLSearchParams | null = null;
    const fetchImpl: GscFetch = async (input, init) => {
      expect(input).toBe(OAUTH_TOKEN_URL);
      received = new URLSearchParams(String(init?.body ?? ''));
      return new Response(
        JSON.stringify({
          access_token: 'at',
          expires_in: 3600,
          refresh_token: 'rt',
          token_type: 'Bearer',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    };
    const tokens = await exchangeCode(
      {
        clientId: 'cid',
        clientSecret: 'csec',
        redirectUri: 'https://app/callback',
        fetch: fetchImpl,
      },
      'auth-code',
    );
    expect(tokens.access_token).toBe('at');
    expect(received).not.toBeNull();
    expect(received!.get('code')).toBe('auth-code');
    expect(received!.get('grant_type')).toBe('authorization_code');
  });

  it('refresh: POSTs grant_type=refresh_token with the refresh token', async () => {
    let received: URLSearchParams | null = null;
    const fetchImpl: GscFetch = async (_input, init) => {
      received = new URLSearchParams(String(init?.body ?? ''));
      return new Response(
        JSON.stringify({ access_token: 'at2', expires_in: 3600, token_type: 'Bearer' }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    };
    const tokens = await refreshAccessToken(
      { clientId: 'cid', clientSecret: 'csec', redirectUri: 'r', fetch: fetchImpl },
      'rt',
    );
    expect(tokens.access_token).toBe('at2');
    expect(received).not.toBeNull();
    expect(received!.get('grant_type')).toBe('refresh_token');
    expect(received!.get('refresh_token')).toBe('rt');
  });
});

describe('SearchConsoleClient.searchAnalyticsQuery', () => {
  it('returns rows on success', async () => {
    const client = new SearchConsoleClient({
      accessToken: 'tok',
      fetch: mock(
        () =>
          new Response(
            JSON.stringify({
              rows: [
                { keys: ['2026-01-01'], clicks: 5, impressions: 100, ctr: 0.05, position: 4.2 },
              ],
              responseAggregationType: 'byProperty',
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
      ),
    });
    const out = await client.searchAnalyticsQuery('https://example.com/', {
      startDate: '2026-01-01',
      endDate: '2026-01-01',
      dimensions: ['date'],
    });
    expect(out.rows).toHaveLength(1);
    expect(out.rows?.[0]?.clicks).toBe(5);
  });

  it('classifies 401 as auth_failed', async () => {
    const client = new SearchConsoleClient({
      accessToken: 'tok',
      fetch: mock(
        () =>
          new Response(
            JSON.stringify({
              error: { message: 'Invalid Credentials', code: 401, status: 'UNAUTHENTICATED' },
            }),
            { status: 401, headers: { 'content-type': 'application/json' } },
          ),
      ),
    });
    let caught: unknown;
    try {
      await client.searchAnalyticsQuery('s', { startDate: '2026-01-01', endDate: '2026-01-01' });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(GscError);
    expect((caught as GscError).code).toBe('auth_failed');
  });
});
