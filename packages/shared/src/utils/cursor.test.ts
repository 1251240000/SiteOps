import { describe, expect, it } from 'vitest';

import { clampLimit, decodeCursor, encodeCursor, type Cursor } from './cursor.js';

const SAMPLE: Cursor = {
  id: '8c5a8e4a-5e91-4f7d-9f9e-1f9b3c8b6c2c',
  ts: '2026-05-12T08:30:00.000Z',
};

describe('encodeCursor / decodeCursor', () => {
  it('round-trips a well-formed cursor', () => {
    const enc = encodeCursor(SAMPLE);
    expect(typeof enc).toBe('string');
    // base64url never contains `=`, `+`, or `/`
    expect(enc).not.toMatch(/[=+/]/);
    expect(decodeCursor(enc)).toEqual(SAMPLE);
  });

  it('encodes bigint-style ids transparently', () => {
    const enc = encodeCursor({ id: '90071992547409921', ts: '2026-01-01T00:00:00.000Z' });
    expect(decodeCursor(enc)?.id).toBe('90071992547409921');
  });

  it('returns null for empty / missing input', () => {
    expect(decodeCursor(null)).toBeNull();
    expect(decodeCursor(undefined)).toBeNull();
    expect(decodeCursor('')).toBeNull();
  });

  it('returns null for non-base64 garbage', () => {
    // The Buffer base64url decoder is lenient; force the failure by giving
    // a payload whose decoded form is definitely not JSON.
    expect(decodeCursor('!!!not-base64!!!')).toBeNull();
  });

  it('returns null when the decoded body is not valid JSON', () => {
    const malformed = Buffer.from('not-json{', 'utf8').toString('base64url');
    expect(decodeCursor(malformed)).toBeNull();
  });

  it('returns null when required fields are missing', () => {
    const missingTs = Buffer.from(JSON.stringify({ id: 'abc' }), 'utf8').toString('base64url');
    expect(decodeCursor(missingTs)).toBeNull();

    const missingId = Buffer.from(JSON.stringify({ ts: SAMPLE.ts }), 'utf8').toString('base64url');
    expect(decodeCursor(missingId)).toBeNull();
  });

  it('returns null when fields have the wrong type', () => {
    const badId = Buffer.from(JSON.stringify({ id: 123, ts: SAMPLE.ts }), 'utf8').toString(
      'base64url',
    );
    expect(decodeCursor(badId)).toBeNull();

    const badTs = Buffer.from(JSON.stringify({ id: SAMPLE.id, ts: 0 }), 'utf8').toString(
      'base64url',
    );
    expect(decodeCursor(badTs)).toBeNull();
  });

  it('returns null when `ts` is not a parseable date', () => {
    const badTs = Buffer.from(JSON.stringify({ id: SAMPLE.id, ts: 'not-a-date' }), 'utf8').toString(
      'base64url',
    );
    expect(decodeCursor(badTs)).toBeNull();
  });

  it('returns null when the payload is a JSON literal but not an object', () => {
    const arrayBody = Buffer.from(JSON.stringify(['nope']), 'utf8').toString('base64url');
    expect(decodeCursor(arrayBody)).toBeNull();

    const nullBody = Buffer.from('null', 'utf8').toString('base64url');
    expect(decodeCursor(nullBody)).toBeNull();
  });

  it('is deterministic — encoding the same input twice yields identical bytes', () => {
    expect(encodeCursor(SAMPLE)).toBe(encodeCursor({ ...SAMPLE }));
  });
});

describe('clampLimit', () => {
  it('returns the default when input is missing / non-finite', () => {
    expect(clampLimit(undefined, 20)).toBe(20);
    expect(clampLimit(null, 20)).toBe(20);
    expect(clampLimit(Number.NaN, 20)).toBe(20);
    expect(clampLimit(Number.POSITIVE_INFINITY, 20)).toBe(20);
  });

  it('clamps below 1 to 1', () => {
    expect(clampLimit(0, 50)).toBe(1);
    expect(clampLimit(-5, 50)).toBe(1);
  });

  it('clamps above max to max (default max = 100)', () => {
    expect(clampLimit(500, 50)).toBe(100);
    expect(clampLimit(101, 50)).toBe(100);
  });

  it('respects a custom max', () => {
    expect(clampLimit(500, 50, 200)).toBe(200);
    expect(clampLimit(50, 20, 200)).toBe(50);
  });

  it('floors floats', () => {
    expect(clampLimit(20.9, 10)).toBe(20);
  });
});
