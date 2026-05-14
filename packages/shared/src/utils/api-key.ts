import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';

import { BCRYPT_COST } from './password.js';

/** Length in bytes of the random source. 32 bytes → ~43 char base64url. */
export const API_KEY_RANDOM_BYTES = 32;
/** Length of the plaintext prefix stored alongside the hash (display only). */
export const API_KEY_PREFIX_LENGTH = 8;

export type GeneratedApiKey = {
  /** Full plaintext token. Returned to the caller exactly once. */
  plaintext: string;
  /** First `API_KEY_PREFIX_LENGTH` chars of the plaintext. Persist alongside the hash. */
  prefix: string;
  /** bcrypt hash of the full plaintext. Persist in `api_keys.key_hash`. */
  hash: string;
};

/**
 * Generate a fresh API key.
 *
 * Format: base64url of 32 cryptographically-random bytes (no `=` padding).
 * The plaintext is returned only here; downstream code must store
 * `{ prefix, hash }` and surface `plaintext` to the user exactly once.
 */
export async function generateApiKey(): Promise<GeneratedApiKey> {
  const plaintext = randomBytes(API_KEY_RANDOM_BYTES).toString('base64url');
  const prefix = plaintext.slice(0, API_KEY_PREFIX_LENGTH);
  const hash = await bcrypt.hash(plaintext, BCRYPT_COST);
  return { plaintext, prefix, hash };
}

/** Hash an externally-supplied plaintext API key (e.g. for migration). */
export async function hashApiKey(plaintext: string): Promise<string> {
  if (!plaintext) throw new TypeError('hashApiKey: plaintext required');
  return bcrypt.hash(plaintext, BCRYPT_COST);
}

/**
 * Verify a plaintext API key against a stored bcrypt hash. Uses bcrypt's
 * constant-time compare internally; returns `false` on any malformed input.
 */
export async function compareApiKey(plaintext: string, hash: string): Promise<boolean> {
  if (!plaintext || !hash) return false;
  try {
    return await bcrypt.compare(plaintext, hash);
  } catch {
    return false;
  }
}

/** Extract the stored prefix from a plaintext key (no I/O). */
export function apiKeyPrefix(plaintext: string): string {
  return plaintext.slice(0, API_KEY_PREFIX_LENGTH);
}
