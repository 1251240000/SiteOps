import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));
vi.mock('@/lib/db', () => ({ getDb: vi.fn(() => undefined) }));

import { OPTIONS, POST } from '@/app/api/v1/collect/route';
import { buildRequest, readJson } from '@/__tests__/helpers';

describe('POST /api/v1/collect CORS', () => {
  it('answers preflight requests for browser tracker submissions', async () => {
    const req = await buildRequest('http://localhost/api/v1/collect', {
      method: 'OPTIONS',
      headers: {
        origin: 'https://example.com',
        'access-control-request-method': 'POST',
      },
    });

    const res = OPTIONS(req);

    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('https://example.com');
    expect(res.headers.get('access-control-allow-methods')).toContain('POST');
    expect(res.headers.get('access-control-allow-headers')).toContain('content-type');
  });

  it('keeps CORS headers on validation errors', async () => {
    const req = await buildRequest('http://localhost/api/v1/collect', {
      method: 'POST',
      headers: { origin: 'https://example.com' },
      body: { bad: true },
    });

    const res = await POST(req);

    expect(res.status).toBe(400);
    expect(res.headers.get('access-control-allow-origin')).toBe('https://example.com');
    const body = await readJson<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('validation_failed');
  });
});
