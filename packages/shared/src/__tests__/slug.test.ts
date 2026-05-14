import { describe, expect, it } from 'vitest';

import { nextAvailableSlug, slugify } from '../utils/slug.js';

describe('slugify', () => {
  it('lower-cases and dashes', () => {
    expect(slugify('Hello World')).toBe('hello-world');
  });
  it('collapses runs of separators', () => {
    expect(slugify('Hello -- World!!! ##')).toBe('hello-world');
  });
  it('strips diacritics', () => {
    expect(slugify('Café Münchën')).toBe('cafe-munchen');
  });
  it('falls back to "site" for empty input', () => {
    expect(slugify('')).toBe('site');
    expect(slugify('---')).toBe('site');
    expect(slugify('中文 only')).toBe('only');
  });
  it('caps at 64 chars and trims trailing dashes after cut', () => {
    const long = 'a'.repeat(80);
    const out = slugify(long);
    expect(out.length).toBeLessThanOrEqual(64);
    expect(out.endsWith('-')).toBe(false);
  });
});

describe('nextAvailableSlug', () => {
  it('returns base when not taken', () => {
    expect(nextAvailableSlug('foo', [])).toBe('foo');
  });
  it('appends -2 on first collision', () => {
    expect(nextAvailableSlug('foo', ['foo'])).toBe('foo-2');
  });
  it('walks until free', () => {
    expect(nextAvailableSlug('foo', ['foo', 'foo-2', 'foo-3'])).toBe('foo-4');
  });
  it('throws when no slot is available within `attempts`', () => {
    // attempts=3 → checks foo-2, foo-3, foo-4. Block all four so none free.
    const taken = ['foo', 'foo-2', 'foo-3', 'foo-4'];
    expect(() => nextAvailableSlug('foo', taken, 3)).toThrow();
  });
});
