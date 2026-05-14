import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  Ga4Client,
  parseServiceAccountEnv,
  signServiceAccountJwt,
  type Ga4Fetch,
  type GoogleServiceAccount,
} from './client.js';

function makeServiceAccount(): GoogleServiceAccount {
  const { publicKey: _pub, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  void _pub;
  return {
    client_email: 'ga4-test@project.iam.gserviceaccount.com',
    private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  };
}

function mock(
  handler: (input: string, init?: RequestInit) => Response | Promise<Response>,
): Ga4Fetch {
  return (input, init) => Promise.resolve(handler(input, init));
}

describe('parseServiceAccountEnv', () => {
  it('parses raw JSON', () => {
    const text = JSON.stringify({ client_email: 'x@y', private_key: 'k' });
    const sa = parseServiceAccountEnv(text);
    expect(sa.client_email).toBe('x@y');
  });
  it('parses base64', () => {
    const json = JSON.stringify({ client_email: 'x@y', private_key: 'k' });
    const b64 = Buffer.from(json).toString('base64');
    const sa = parseServiceAccountEnv(b64);
    expect(sa.client_email).toBe('x@y');
  });
  it('rejects missing fields', () => {
    expect(() => parseServiceAccountEnv('{}')).toThrow();
  });
});

describe('signServiceAccountJwt', () => {
  it('returns a three-segment JWT signed with the SA key', () => {
    const sa = makeServiceAccount();
    const jwt = signServiceAccountJwt(sa, { now: Date.UTC(2026, 0, 1) });
    const parts = jwt.split('.');
    expect(parts).toHaveLength(3);
    const header = JSON.parse(Buffer.from(parts[0]!, 'base64url').toString());
    expect(header.alg).toBe('RS256');
    const payload = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString());
    expect(payload.iss).toBe(sa.client_email);
    expect(payload.exp - payload.iat).toBe(3600);
  });
});

describe('Ga4Client.runReport', () => {
  it('exchanges JWT then issues the report', async () => {
    const sa = makeServiceAccount();
    let tokenCalls = 0;
    let reportCalls = 0;
    const client = new Ga4Client({
      serviceAccount: sa,
      fetch: mock((input) => {
        if (String(input).includes('oauth2.googleapis.com')) {
          tokenCalls += 1;
          return new Response(
            JSON.stringify({ access_token: 'tok', expires_in: 3600, token_type: 'Bearer' }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          );
        }
        reportCalls += 1;
        return new Response(
          JSON.stringify({
            rowCount: 1,
            rows: [
              {
                dimensionValues: [{ value: '20260101' }],
                metricValues: [{ value: '42' }, { value: '40' }],
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }),
    });
    const report = await client.runReport('123456', {
      dateRanges: [{ startDate: '2026-01-01', endDate: '2026-01-01' }],
      metrics: [{ name: 'sessions' }, { name: 'screenPageViews' }],
      dimensions: [{ name: 'date' }],
    });
    expect(tokenCalls).toBe(1);
    expect(reportCalls).toBe(1);
    expect(report.rows?.[0]?.metricValues?.[0]?.value).toBe('42');
  });

  it('surfaces 403 as auth_failed', async () => {
    const sa = makeServiceAccount();
    const client = new Ga4Client({
      serviceAccount: sa,
      fetch: mock((input) => {
        if (String(input).includes('oauth2.googleapis.com')) {
          return new Response(
            JSON.stringify({ access_token: 'tok', expires_in: 3600, token_type: 'Bearer' }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          );
        }
        return new Response(
          JSON.stringify({
            error: { message: 'access denied', code: 403, status: 'PERMISSION_DENIED' },
          }),
          { status: 403, headers: { 'content-type': 'application/json' } },
        );
      }),
    });
    await expect(
      client.runReport('p', {
        dateRanges: [{ startDate: '2026-01-01', endDate: '2026-01-01' }],
        metrics: [{ name: 'sessions' }],
      }),
    ).rejects.toMatchObject({ code: 'auth_failed' });
  });
});
