/**
 * Lock-down tests for the schema-message → catalog-key map. The literal
 * strings here come straight from `packages/shared/src/schemas/*` — if a
 * schema author renames a message we want a loud test failure rather than
 * a silent fallback to the raw English token in the dashboard UI.
 */
import { describe, expect, it } from 'vitest';

import { translateFormError, translateFormErrors } from './zod-form-errors';

// Minimal stand-in for the `useTranslations` return value; just echoes the
// key + values so assertions can verify which key was looked up.
const fakeT = ((key: string, values?: Record<string, unknown>) => {
  if (values && Object.keys(values).length > 0) {
    return `[${key}:${JSON.stringify(values)}]`;
  }
  return `[${key}]`;
}) as unknown as Parameters<typeof translateFormError>[1];

describe('translateFormError', () => {
  it.each([
    ['required', '[required]'],
    ['must be a valid URL', '[invalidUrl]'],
    ['must be a valid UUID', '[invalidUuid]'],
    ['must use https', '[mustUseHttps]'],
    ['must use http or https', '[mustUseHttpHttps]'],
    ['host is not publicly addressable', '[hostNotPublic]'],
    ['host is a private IP range', '[hostPrivateIp]'],
    ['tags must be alphanumeric / dashes', '[tagsAlphanumeric]'],
    ['must be lowercase kebab-case', '[mustBeKebabCase]'],
    ['must be ISO-8601 with timezone', '[mustBeIso8601]'],
    ['must be YYYY-MM-DD', '[mustBeIsoDate]'],
    ['must be ISO-4217 (3 uppercase letters)', '[mustBeIso4217]'],
    ['invalid domain', '[invalidDomain]'],
  ])('translates %s', (input, expected) => {
    expect(translateFormError(input, fakeT)).toBe(expected);
  });

  it('passes through unknown messages untouched', () => {
    expect(translateFormError('something exotic', fakeT)).toBe('something exotic');
  });

  it('returns undefined for missing message', () => {
    expect(translateFormError(undefined, fakeT)).toBeUndefined();
  });
});

describe('translateFormErrors', () => {
  it('rewrites every leaf message in a react-hook-form errors tree', () => {
    const errors: Record<string, unknown> = {
      name: { type: 'too_small', message: 'required' },
      primaryUrl: { type: 'custom', message: 'must use https' },
      tags: {
        // nested array-shaped errors mirror what zod emits for `path: ['tags', 0]`.
        '0': { type: 'invalid_string', message: 'tags must be alphanumeric / dashes' },
      },
      notes: { type: 'too_big', message: 'completely unknown text' },
    };
    translateFormErrors(errors, fakeT);
    expect((errors.name as { message: string }).message).toBe('[required]');
    expect((errors.primaryUrl as { message: string }).message).toBe('[mustUseHttps]');
    expect((errors.tags as Record<string, { message: string }>)['0']!.message).toBe(
      '[tagsAlphanumeric]',
    );
    // Unknown messages should pass through (loud-but-not-broken).
    expect((errors.notes as { message: string }).message).toBe('completely unknown text');
  });

  it('is a no-op when errors is undefined', () => {
    expect(() => translateFormErrors(undefined, fakeT)).not.toThrow();
  });
});
