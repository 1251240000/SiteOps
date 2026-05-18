/**
 * HMAC verification helpers shared by webhook receivers (T27).
 *
 * Constraints we care about:
 *
 *   1. **Timing-safe compare** — string `===` leaks the position of the first
 *      mismatching byte. `crypto.timingSafeEqual` over fixed-length buffers
 *      keeps the comparison constant-time.
 *   2. **Length normalisation** — `timingSafeEqual` throws when the two
 *      buffers differ in length, which itself becomes a side channel. We
 *      compare lengths first (fast reject) and only descend into the
 *      timing-safe routine when they match.
 *   3. **Hex tolerance** — provider headers sometimes ship the digest with a
 *      `sha256=` prefix (GitHub) or as plain hex (Cloudflare). Callers
 *      should strip provider-specific prefixes before passing the value in.
 *
 * Module is intentionally Node-only (`node:crypto`); webhooks are server-side
 * and the edge runtime is not in scope for T27.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Constant-time equality check for two hex strings.
 *
 * Returns `false` if either string is empty, contains non-hex chars, or has
 * a different length from the other. Never throws.
 */
export function timingSafeEqualHex(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length === 0 || b.length === 0) return false;
  // Length check is itself constant-time relative to the comparison cost we
  // *would* pay — the early return reveals "different length" which the
  // attacker already knows from the bytes-on-the-wire, so this is fine.
  if (a.length !== b.length) return false;
  let bufA: Buffer;
  let bufB: Buffer;
  try {
    bufA = Buffer.from(a, 'hex');
    bufB = Buffer.from(b, 'hex');
  } catch {
    return false;
  }
  // `Buffer.from('zz', 'hex')` silently yields an empty buffer; guard.
  if (bufA.length === 0 || bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Verify a `sha256(secret, rawBody)` HMAC digest delivered as a hex string.
 *
 * Returns `false` on any malformed input. Does not throw.
 *
 * @param secret  shared secret configured on both sides (`>= 16 chars`)
 * @param rawBody raw HTTP body *bytes* — must be the exact string received
 *                from the network, no `JSON.parse`/`stringify` round-trip
 * @param signatureHex digest from the provider header, e.g. `aab1c2…`
 */
export function verifyHmacSha256(secret: string, rawBody: string, signatureHex: string): boolean {
  if (!secret || !rawBody || !signatureHex) return false;
  const expected = createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
  return timingSafeEqualHex(expected, signatureHex);
}

/**
 * Convenience for GitHub-style signatures shaped like `sha256=<hex>`.
 * Returns `false` for any other shape.
 */
export function verifyGitHubSignature(
  secret: string,
  rawBody: string,
  headerValue: string | null | undefined,
): boolean {
  if (!headerValue) return false;
  const match = /^sha256=([a-f0-9]+)$/i.exec(headerValue.trim());
  if (!match || !match[1]) return false;
  return verifyHmacSha256(secret, rawBody, match[1]);
}
