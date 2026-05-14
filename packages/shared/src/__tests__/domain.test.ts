import { describe, expect, it } from 'vitest';

import { isValidDomain, normalizeDomain } from '../utils/domain.js';

describe('normalizeDomain', () => {
  it('lowercases and trims whitespace', () => {
    expect(normalizeDomain('   Example.COM ')).toBe('example.com');
  });
  it('strips scheme', () => {
    expect(normalizeDomain('https://example.com')).toBe('example.com');
    expect(normalizeDomain('http://example.com')).toBe('example.com');
  });
  it('strips path / query / hash', () => {
    expect(normalizeDomain('https://example.com/foo?x=1#y')).toBe('example.com');
    expect(normalizeDomain('example.com/foo')).toBe('example.com');
  });
  it('strips port and userinfo', () => {
    expect(normalizeDomain('user:pass@example.com:8443')).toBe('example.com');
    expect(normalizeDomain('example.com:443')).toBe('example.com');
  });
  it('strips trailing dot (FQDN form)', () => {
    expect(normalizeDomain('example.com.')).toBe('example.com');
  });
  it('returns empty string on empty / whitespace input', () => {
    expect(normalizeDomain('')).toBe('');
    expect(normalizeDomain('   ')).toBe('');
  });
});

describe('isValidDomain', () => {
  it('accepts simple hostnames', () => {
    expect(isValidDomain('example.com')).toBe(true);
    expect(isValidDomain('sub.example.co.uk')).toBe(true);
    expect(isValidDomain('a-b.example.com')).toBe(true);
  });
  it('normalises before checking', () => {
    expect(isValidDomain('HTTPS://Example.Com/')).toBe(true);
  });
  it('accepts punycode labels', () => {
    expect(isValidDomain('xn--bcher-kva.example')).toBe(true);
  });
  it('rejects bare TLDs / single-label hosts', () => {
    expect(isValidDomain('example')).toBe(false);
    expect(isValidDomain('com')).toBe(false);
  });
  it('rejects labels starting / ending with a dash', () => {
    expect(isValidDomain('-bad.example.com')).toBe(false);
    expect(isValidDomain('bad-.example.com')).toBe(false);
  });
  it('rejects forbidden local suffixes', () => {
    expect(isValidDomain('localhost')).toBe(false);
    expect(isValidDomain('foo.localhost')).toBe(false);
    expect(isValidDomain('foo.local')).toBe(false);
  });
  it('rejects empty / whitespace input', () => {
    expect(isValidDomain('')).toBe(false);
    expect(isValidDomain('   ')).toBe(false);
  });
  it('rejects domains longer than 253 chars', () => {
    const long = `${'a'.repeat(63)}.${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(63)}.com`;
    expect(long.length).toBeGreaterThan(253);
    expect(isValidDomain(long)).toBe(false);
  });
});
