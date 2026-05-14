import { describe, expect, it } from 'vitest';

import {
  API_KEY_PREFIX_LENGTH,
  apiKeyPrefix,
  compareApiKey,
  generateApiKey,
  hashApiKey,
} from '../utils/api-key.js';

describe('api-key utils', () => {
  it('generateApiKey returns a base64url plaintext of ~43 chars', async () => {
    const key = await generateApiKey();
    // 32 random bytes → ceil(32 * 4 / 3) = 43, but base64url drops padding
    expect(key.plaintext.length).toBeGreaterThanOrEqual(42);
    expect(key.plaintext.length).toBeLessThanOrEqual(44);
    expect(key.plaintext).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('prefix matches the first 8 chars of the plaintext', async () => {
    const key = await generateApiKey();
    expect(key.prefix).toHaveLength(API_KEY_PREFIX_LENGTH);
    expect(key.plaintext.startsWith(key.prefix)).toBe(true);
    expect(apiKeyPrefix(key.plaintext)).toBe(key.prefix);
  });

  it('hash verifies against the original plaintext', async () => {
    const key = await generateApiKey();
    expect(await compareApiKey(key.plaintext, key.hash)).toBe(true);
  });

  it('hash rejects a different plaintext', async () => {
    const key = await generateApiKey();
    expect(await compareApiKey('not-the-key', key.hash)).toBe(false);
  });

  it('compareApiKey returns false for malformed hashes (no throw)', async () => {
    expect(await compareApiKey('whatever', 'garbage')).toBe(false);
  });

  it('hashApiKey produces bcrypt-format output', async () => {
    const hash = await hashApiKey('abc123');
    expect(hash).toMatch(/^\$2[ab]\$/);
    expect(await compareApiKey('abc123', hash)).toBe(true);
  });

  it('two generations produce distinct plaintexts (entropy check)', async () => {
    const [a, b] = await Promise.all([generateApiKey(), generateApiKey()]);
    expect(a.plaintext).not.toEqual(b.plaintext);
    expect(a.hash).not.toEqual(b.hash);
  });
});
