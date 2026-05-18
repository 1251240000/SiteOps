/**
 * Pin the protected-prefix list. The intent is to catch silent regressions
 * where someone adds an admin/ops path without flagging it as protected;
 * the per-page `redirect()` calls inside individual server components are
 * NOT a substitute — middleware runs before any rendering.
 */
import { describe, expect, it } from 'vitest';

import { isProtectedPath } from '@/lib/auth.config';

describe('isProtectedPath', () => {
  it('always treats / as protected', () => {
    expect(isProtectedPath('/')).toBe(true);
  });

  it.each([
    '/login',
    '/login?callbackUrl=/sites',
    '/api/v1/hooks/github',
    '/api/health',
    '/_next/static/foo.js',
    '/favicon.ico',
  ])('does NOT protect public path: %s', (path) => {
    expect(isProtectedPath(path)).toBe(false);
  });

  it.each([
    '/sites',
    '/sites/abcd-1234',
    '/agent-runs',
    '/tasks',
    '/webhooks',
    '/webhooks/some-id',
    '/settings',
    '/settings/api-keys',
    '/admin',
    '/admin/queues',
    '/admin/queues/foo/bar',
  ])('protects dashboard / admin path: %s', (path) => {
    expect(isProtectedPath(path)).toBe(true);
  });

  it('treats /admin as protected so any future Bull-Board mount inherits the gate', () => {
    expect(isProtectedPath('/admin/queues')).toBe(true);
    expect(isProtectedPath('/admin/queues/api/jobs')).toBe(true);
  });

  it('does not match accidental prefix overlaps (e.g. /admin-public)', () => {
    expect(isProtectedPath('/admin-public')).toBe(false);
    expect(isProtectedPath('/sitesxyz')).toBe(false);
    expect(isProtectedPath('/settingsfoo')).toBe(false);
  });
});
