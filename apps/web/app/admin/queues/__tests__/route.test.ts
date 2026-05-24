/**
 * Route-handler tests for `/admin/queues` Bull-Board mount (T39).
 *
 * We mock `@/lib/auth`, `@/lib/db`, `@/lib/queues`, and the heavy
 * bull-board packages so the test doesn't need a live Redis or the
 * full UI asset tree.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));
vi.mock('@/lib/db', () => ({ getDb: vi.fn() }));
vi.mock('@/lib/queues', () => ({
  ALL_QUEUES: ['uptime-check', 'alert-fire'],
  getProducerQueue: vi.fn().mockReturnValue({}),
}));

// Mock bull-board to avoid ejs / static asset resolution at test time.
vi.mock('@bull-board/api', () => ({
  createBullBoard: vi.fn(),
}));
vi.mock('@bull-board/api/bullMQAdapter', () => ({
  BullMQAdapter: vi.fn().mockImplementation((q: unknown) => ({ queue: q })),
}));
vi.mock('@bull-board/hono', async () => {
  const { Hono } = await import('hono');
  return {
    HonoAdapter: vi.fn().mockImplementation(() => {
      const app = new Hono();
      // Minimal stub: return 200 HTML for any GET
      app.get('*', (c) => c.html('<html><body>bull-board stub</body></html>'));
      app.post('*', (c) => c.json({ ok: true }));
      app.put('*', (c) => c.json({ ok: true }));
      return {
        setBasePath: vi.fn().mockReturnThis(),
        registerPlugin: vi.fn().mockReturnValue(app),
      };
    }),
  };
});

import { GET, POST } from '@/app/admin/queues/[[...path]]/route';
import { buildRequest, FAKE_SESSION, setSession } from '@/__tests__/helpers';
import { __resetEnvForTests } from '@/lib/env';

beforeAll(async () => {
  await setSession(FAKE_SESSION);
});

beforeEach(async () => {
  await setSession(FAKE_SESSION);
  __resetEnvForTests();
});

afterAll(() => {
  vi.restoreAllMocks();
});

describe('GET /admin/queues', () => {
  it('redirects to /login without a session', async () => {
    await setSession(null);
    const res = await GET(await buildRequest('http://localhost/admin/queues'));
    // redirect response
    expect(res.status).toBeGreaterThanOrEqual(300);
    expect(res.status).toBeLessThan(400);
    expect(res.headers.get('location')).toMatch(/\/login/);
  });

  it('returns 200 HTML when admin is logged in', async () => {
    const res = await GET(await buildRequest('http://localhost/admin/queues'));
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('bull-board');
  });

  it('returns 404 when ADMIN_QUEUES_ENABLED=false', async () => {
    process.env['ADMIN_QUEUES_ENABLED'] = 'false';
    __resetEnvForTests();

    const res = await GET(await buildRequest('http://localhost/admin/queues'));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe('not_found');

    // Restore
    delete process.env['ADMIN_QUEUES_ENABLED'];
    __resetEnvForTests();
  });
});

describe('POST /admin/queues (API calls)', () => {
  it('delegates POST to the Hono app when authed', async () => {
    const res = await POST(
      await buildRequest('http://localhost/admin/queues/api/queues', {
        method: 'POST',
        body: {},
      }),
    );
    expect(res.status).toBe(200);
  });
});
