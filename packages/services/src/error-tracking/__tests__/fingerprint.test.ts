import { describe, expect, it } from 'vitest';

import { fingerprint, simplifyStack } from '../fingerprint.js';

describe('fingerprint', () => {
  it('is stable across whitespace + case in the message', () => {
    const a = fingerprint({ source: 'js', level: 'error', message: 'Boom!' });
    const b = fingerprint({ source: 'js', level: 'error', message: '  BOOM!  ' });
    expect(a).toBe(b);
  });

  it('changes with source / level', () => {
    const base = { message: 'oops' } as const;
    const a = fingerprint({ ...base, source: 'js', level: 'error' });
    const b = fingerprint({ ...base, source: 'api', level: 'error' });
    const c = fingerprint({ ...base, source: 'js', level: 'warning' });
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
  });

  it('collapses line / column numbers in stacks', () => {
    const a = fingerprint({
      source: 'js',
      level: 'error',
      message: 'oops',
      stack: 'at foo (/app/index.js:12:5)\nat bar (/app/lib.js:1:10)',
    });
    const b = fingerprint({
      source: 'js',
      level: 'error',
      message: 'oops',
      stack: 'at foo (/app/index.js:88:99)\nat bar (/app/lib.js:5:2)',
    });
    expect(a).toBe(b);
  });

  it('distinguishes different call sites', () => {
    const a = fingerprint({
      source: 'js',
      level: 'error',
      message: 'oops',
      stack: 'at foo (/app/a.js:1)',
    });
    const b = fingerprint({
      source: 'js',
      level: 'error',
      message: 'oops',
      stack: 'at bar (/app/a.js:1)',
    });
    expect(a).not.toBe(b);
  });

  it('returns 64 hex chars', () => {
    const fp = fingerprint({ source: 'js', level: 'error', message: 'oops' });
    expect(fp).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('simplifyStack', () => {
  it('returns empty string for null/empty', () => {
    expect(simplifyStack(null)).toBe('');
    expect(simplifyStack('')).toBe('');
  });
});
