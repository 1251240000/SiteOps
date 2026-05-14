import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { AppError } from '../errors.js';
import { parseEnv } from '../utils/env.js';

const schema = z.object({
  DATABASE_URL: z.string().url(),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  PORT: z.coerce.number().int().positive(),
});

describe('parseEnv', () => {
  it('returns parsed env on success', () => {
    const out = parseEnv(schema, {
      DATABASE_URL: 'postgres://x:y@localhost:5432/db',
      PORT: '3000',
    });
    expect(out.DATABASE_URL).toBe('postgres://x:y@localhost:5432/db');
    expect(out.LOG_LEVEL).toBe('info');
    expect(out.PORT).toBe(3000);
  });

  it('throws AppError with code=invalid_env on missing var', () => {
    let caught: unknown;
    try {
      parseEnv(schema, { LOG_LEVEL: 'debug' });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(AppError);
    const err = caught as AppError;
    expect(err.code).toBe('invalid_env');
    expect(err.status).toBe(500);
    expect(err.message).toMatch(/DATABASE_URL/);
    expect(err.message).toMatch(/PORT/);
    expect(err.details?.['issues']).toBeDefined();
  });

  it('throws AppError on invalid value type', () => {
    expect(() =>
      parseEnv(schema, {
        DATABASE_URL: 'not-a-url',
        PORT: 'abc',
      }),
    ).toThrow(AppError);
  });
});
