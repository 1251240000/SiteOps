import { describe, expect, it } from 'vitest';

import { resolvePublicAppOrigin } from './public-origin.js';

function headers(values: Record<string, string | undefined>) {
  return {
    get(name: string): string | null {
      return values[name.toLowerCase()] ?? null;
    },
  };
}

describe('resolvePublicAppOrigin', () => {
  it('prefers an explicit public origin and normalizes paths', () => {
    expect(
      resolvePublicAppOrigin(headers({ host: 'internal:3000' }), {
        SITEOPS_PUBLIC_ORIGIN: 'https://ops.example.com/admin',
        AUTH_URL: 'http://wrong.example.com',
      }),
    ).toBe('https://ops.example.com');
  });

  it('falls back to AUTH_URL before request headers', () => {
    expect(
      resolvePublicAppOrigin(headers({ 'x-forwarded-proto': 'http', host: 'internal:3000' }), {
        AUTH_URL: 'https://ops.example.com',
      }),
    ).toBe('https://ops.example.com');
  });

  it('uses reverse proxy forwarded headers when no public origin is configured', () => {
    expect(
      resolvePublicAppOrigin(
        headers({
          'x-forwarded-proto': 'https,http',
          'x-forwarded-host': 'ops.example.com, internal:3000',
        }),
        {},
      ),
    ).toBe('https://ops.example.com');
  });

  it('understands the standard Forwarded header', () => {
    expect(
      resolvePublicAppOrigin(
        headers({ forwarded: 'for=10.0.0.1;proto=https;host=ops.example.com' }),
        {},
      ),
    ).toBe('https://ops.example.com');
  });
});
