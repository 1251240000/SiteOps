import { describe, expect, it } from 'vitest';

import { BCRYPT_COST, comparePassword, hashPassword } from '../utils/password.js';

describe('password utils', () => {
  it('hashes a plaintext to a bcrypt-format string', async () => {
    const hash = await hashPassword('correct horse battery staple');
    // bcryptjs always prefixes with `$2a$` (or `$2b$`) + cost
    expect(hash).toMatch(new RegExp(`^\\$2[ab]\\$${BCRYPT_COST}\\$`));
  });

  it('comparePassword returns true for matching plaintext', async () => {
    const hash = await hashPassword('hunter2');
    expect(await comparePassword('hunter2', hash)).toBe(true);
  });

  it('comparePassword returns false on mismatch', async () => {
    const hash = await hashPassword('hunter2');
    expect(await comparePassword('hunter3', hash)).toBe(false);
  });

  it('comparePassword returns false on malformed hash (no throw)', async () => {
    expect(await comparePassword('anything', 'not-a-bcrypt-hash')).toBe(false);
  });

  it('hashPassword rejects empty strings', async () => {
    await expect(hashPassword('')).rejects.toThrow(TypeError);
  });
});
