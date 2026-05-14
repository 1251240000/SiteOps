import bcrypt from 'bcryptjs';

/**
 * bcrypt cost factor used for all password hashes in this codebase.
 * 12 is the floor recommended by OWASP (2024) and runs in ~250ms on a
 * modern x86 core. Do not lower without sign-off.
 */
export const BCRYPT_COST = 12;

/** Hash a plaintext password using bcrypt at `BCRYPT_COST`. */
export async function hashPassword(plaintext: string): Promise<string> {
  if (typeof plaintext !== 'string' || plaintext.length === 0) {
    throw new TypeError('hashPassword: plaintext must be a non-empty string');
  }
  return bcrypt.hash(plaintext, BCRYPT_COST);
}

/**
 * Constant-time compare a plaintext against a bcrypt hash. Returns `false`
 * for any malformed hash rather than throwing, so callers don't have to
 * branch on parse errors.
 */
export async function comparePassword(plaintext: string, hash: string): Promise<boolean> {
  if (!plaintext || !hash) return false;
  try {
    return await bcrypt.compare(plaintext, hash);
  } catch {
    return false;
  }
}
