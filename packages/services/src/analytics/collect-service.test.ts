import { describe, expect, it } from 'vitest';

import { allowedOrigin } from './collect-service.js';

describe('allowedOrigin', () => {
  it('allows registered host and subdomains only', () => {
    expect(allowedOrigin('https://example.com', 'https://example.com')).toBe(true);
    expect(allowedOrigin('https://example.com', 'https://docs.example.com')).toBe(true);
    expect(allowedOrigin('https://example.com', 'https://evil-example.com')).toBe(false);
  });
});
