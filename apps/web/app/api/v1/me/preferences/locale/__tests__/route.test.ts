/**
 * Route-handler tests for `POST /api/v1/me/preferences/locale`.
 *
 * Covers:
 *   - 401 when unauthenticated
 *   - 400 on invalid JSON / unknown locale
 *   - 200 + `Set-Cookie: siteops_locale=…` on the happy path
 *
 * The endpoint never touches the DB so the usual PGlite + db-mock dance
 * isn't needed — just session mocking.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));

import { POST } from '@/app/api/v1/me/preferences/locale/route';

import { buildRequest, FAKE_SESSION, readJson, setSession } from '@/__tests__/helpers';

beforeEach(async () => {
  await setSession(FAKE_SESSION);
});

afterAll(() => {
  vi.restoreAllMocks();
});

describe('POST /api/v1/me/preferences/locale', () => {
  it('returns 401 when there is no session', async () => {
    await setSession(null);
    const req = await buildRequest('http://localhost/api/v1/me/preferences/locale', {
      method: 'POST',
      body: { locale: 'en-US' },
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
    const body = await readJson<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('unauthorized');
  });

  it('returns 400 when the body is not JSON', async () => {
    const { NextRequest } = await import('next/server');
    const broken = new Request('http://localhost/api/v1/me/preferences/locale', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not-json',
    });
    const res = await POST(new NextRequest(broken));
    expect(res.status).toBe(400);
    const body = await readJson<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('validation_failed');
  });

  it('returns 400 when the locale is unsupported', async () => {
    const req = await buildRequest('http://localhost/api/v1/me/preferences/locale', {
      method: 'POST',
      body: { locale: 'fr-FR' },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await readJson<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('validation_failed');
  });

  it('persists the locale via Set-Cookie on success', async () => {
    const req = await buildRequest('http://localhost/api/v1/me/preferences/locale', {
      method: 'POST',
      body: { locale: 'en-US' },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await readJson<{ data: { locale: string } }>(res);
    expect(body.data.locale).toBe('en-US');
    // Set-Cookie should carry the new locale, the path, and the SameSite
    // policy. We don't pin Max-Age because next/cookies may render it as
    // a timestamp depending on runtime.
    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).toMatch(/siteops_locale=en-US/);
    expect(setCookie.toLowerCase()).toContain('path=/');
    expect(setCookie.toLowerCase()).toContain('samesite=lax');
  });

  it('round-trips zh-CN', async () => {
    const req = await buildRequest('http://localhost/api/v1/me/preferences/locale', {
      method: 'POST',
      body: { locale: 'zh-CN' },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie') ?? '').toMatch(/siteops_locale=zh-CN/);
  });
});
