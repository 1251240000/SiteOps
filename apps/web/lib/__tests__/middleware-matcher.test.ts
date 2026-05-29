import { describe, expect, it } from 'vitest';

import { MIDDLEWARE_MATCHER } from '@/lib/middleware-matcher';

describe('middleware matcher', () => {
  const re = new RegExp(`^${MIDDLEWARE_MATCHER}$`);

  it('does not run middleware for public tracker bundle', () => {
    expect(re.test('/tracker.js')).toBe(false);
  });

  it('still runs middleware for dashboard pages', () => {
    expect(re.test('/sites/site-id/settings')).toBe(true);
  });
});
