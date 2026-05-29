import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { MIDDLEWARE_MATCHER } from '@/lib/middleware-matcher';

const middlewareSource = readFileSync(
  fileURLToPath(new URL('../../middleware.ts', import.meta.url)),
  'utf8',
);

describe('middleware matcher', () => {
  const re = new RegExp(`^${MIDDLEWARE_MATCHER}$`);

  it('does not run middleware for public tracker bundle', () => {
    expect(re.test('/tracker.js')).toBe(false);
  });

  it('still runs middleware for dashboard pages', () => {
    expect(re.test('/sites/site-id/settings')).toBe(true);
  });

  it('keeps the Next.js middleware config statically analyzable', () => {
    expect(middlewareSource).toContain(`matcher: ['${MIDDLEWARE_MATCHER}']`);
    expect(middlewareSource).not.toContain('matcher: [MIDDLEWARE_MATCHER]');
  });
});
