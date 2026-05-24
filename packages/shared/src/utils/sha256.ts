/**
 * Minimal SHA-256 helper shared across server packages.
 *
 * Used by the idempotency middleware (T37) to fingerprint request bodies,
 * but also handy for any other place that needs a stable content digest
 * (e.g. webhook payload IDs). Node-only — `node:crypto` is the implementation.
 *
 * Returns a lowercase hex string of exactly 64 chars.
 */
import { createHash } from 'node:crypto';

export function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}
