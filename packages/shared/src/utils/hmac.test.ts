import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { timingSafeEqualHex, verifyGitHubSignature, verifyHmacSha256 } from './hmac.js';

const SECRET = 'super-secret-test-key-1234567890';
const BODY = JSON.stringify({ hello: 'world', n: 42 });

function sign(body: string, secret = SECRET): string {
  return createHmac('sha256', secret).update(body, 'utf8').digest('hex');
}

describe('timingSafeEqualHex', () => {
  it('returns true for identical hex strings', () => {
    const a = sign(BODY);
    expect(timingSafeEqualHex(a, a)).toBe(true);
  });

  it('returns false for hex strings of different lengths (no throw)', () => {
    expect(timingSafeEqualHex('aabb', 'aabbcc')).toBe(false);
  });

  it('returns false when a single nibble flips', () => {
    const a = sign(BODY);
    const b = `${a.slice(0, -1)}${a.endsWith('a') ? 'b' : 'a'}`;
    expect(timingSafeEqualHex(a, b)).toBe(false);
  });

  it('returns false for non-hex input without throwing', () => {
    expect(timingSafeEqualHex('zz', 'zz')).toBe(false);
  });

  it('returns false when either side is empty', () => {
    expect(timingSafeEqualHex('', sign(BODY))).toBe(false);
    expect(timingSafeEqualHex(sign(BODY), '')).toBe(false);
  });
});

describe('verifyHmacSha256', () => {
  it('accepts a digest matching the body + secret', () => {
    expect(verifyHmacSha256(SECRET, BODY, sign(BODY))).toBe(true);
  });

  it('rejects when the body is altered by one byte', () => {
    const altered = `${BODY.slice(0, -1)}!`;
    expect(verifyHmacSha256(SECRET, altered, sign(BODY))).toBe(false);
  });

  it('rejects when the secret is wrong', () => {
    expect(verifyHmacSha256('other-secret', BODY, sign(BODY))).toBe(false);
  });

  it('rejects empty inputs without throwing', () => {
    expect(verifyHmacSha256('', BODY, sign(BODY))).toBe(false);
    expect(verifyHmacSha256(SECRET, '', sign(BODY))).toBe(false);
    expect(verifyHmacSha256(SECRET, BODY, '')).toBe(false);
  });
});

describe('verifyGitHubSignature', () => {
  it('accepts a `sha256=<hex>` header value', () => {
    const header = `sha256=${sign(BODY)}`;
    expect(verifyGitHubSignature(SECRET, BODY, header)).toBe(true);
  });

  it('rejects a header value without the sha256= prefix', () => {
    expect(verifyGitHubSignature(SECRET, BODY, sign(BODY))).toBe(false);
  });

  it('rejects when the header is missing entirely', () => {
    expect(verifyGitHubSignature(SECRET, BODY, null)).toBe(false);
    expect(verifyGitHubSignature(SECRET, BODY, undefined)).toBe(false);
    expect(verifyGitHubSignature(SECRET, BODY, '')).toBe(false);
  });

  it('rejects a tampered digest with the right prefix', () => {
    const tampered = `sha256=${sign(BODY).slice(0, -2)}00`;
    expect(verifyGitHubSignature(SECRET, BODY, tampered)).toBe(false);
  });
});
