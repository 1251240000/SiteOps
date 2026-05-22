/**
 * Lock down the dashboard's security response envelope (T33).
 *
 * The acceptance criteria require:
 *   * 5 hard-coded headers always present (CSP family + 4 non-CSP);
 *   * dev mode publishes `Content-Security-Policy-Report-Only`, prod
 *     publishes `Content-Security-Policy` — never both at once;
 *   * the CSP value contains every directive the layout depends on so
 *     a future refactor can't silently drop, say, `frame-ancestors`.
 *
 * These tests are pure unit tests against the helper — middleware
 * integration is verified at the matcher level (config in `middleware.ts`)
 * and end-to-end via the Playwright dashboard-nav suite.
 */
import { describe, expect, it } from 'vitest';

import {
  CSP_DIRECTIVES,
  SECURITY_HEADERS_NON_CSP,
  applySecurityHeaders,
  getCspValue,
} from '@/lib/security-headers';

describe('getCspValue', () => {
  it('joins directives with `; ` so browsers parse them as a single policy', () => {
    const csp = getCspValue();
    expect(csp.split('; ')).toEqual([...CSP_DIRECTIVES]);
  });

  it.each([
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ])('emits the %s directive', (directive) => {
    expect(getCspValue()).toContain(directive);
  });
});

describe('applySecurityHeaders', () => {
  it('sets every non-CSP header to its pinned value', () => {
    const headers = new Headers();
    applySecurityHeaders(headers, { isProd: true });
    for (const [name, value] of SECURITY_HEADERS_NON_CSP) {
      expect(headers.get(name)).toBe(value);
    }
  });

  it('uses the enforcing CSP header in production', () => {
    const headers = new Headers();
    applySecurityHeaders(headers, { isProd: true });
    expect(headers.get('Content-Security-Policy')).toBe(getCspValue());
    expect(headers.get('Content-Security-Policy-Report-Only')).toBeNull();
  });

  it('uses the report-only CSP header outside production', () => {
    const headers = new Headers();
    applySecurityHeaders(headers, { isProd: false });
    expect(headers.get('Content-Security-Policy-Report-Only')).toBe(getCspValue());
    expect(headers.get('Content-Security-Policy')).toBeNull();
  });

  it('overwrites prior values on the same headers bag (idempotent)', () => {
    const headers = new Headers({ 'X-Frame-Options': 'SAMEORIGIN' });
    applySecurityHeaders(headers, { isProd: true });
    expect(headers.get('X-Frame-Options')).toBe('DENY');
  });

  it('does not set HSTS — that is owned by the Caddy edge config', () => {
    const headers = new Headers();
    applySecurityHeaders(headers, { isProd: true });
    expect(headers.get('Strict-Transport-Security')).toBeNull();
  });

  it('preserves headers it does not own (e.g. cookies)', () => {
    const headers = new Headers({ 'Set-Cookie': 'foo=bar; Path=/' });
    applySecurityHeaders(headers, { isProd: true });
    expect(headers.get('Set-Cookie')).toBe('foo=bar; Path=/');
  });
});
