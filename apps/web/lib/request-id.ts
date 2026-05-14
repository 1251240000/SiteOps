import { randomUUID } from 'node:crypto';

/**
 * Generate a short request id used in logs and surfaced on `x-request-id`
 * response headers / `error.requestId` payloads. Shape: `req_<22 chars>`.
 */
export function newRequestId(): string {
  return `req_${randomUUID().replace(/-/g, '').slice(0, 22)}`;
}

/**
 * If the incoming request already carries an `x-request-id` header (set by
 * an upstream proxy / Caddy), trust it as long as it's a sane length;
 * otherwise mint a fresh one.
 */
export function getOrCreateRequestId(headers: Headers): string {
  const supplied = headers.get('x-request-id');
  if (supplied && supplied.length > 0 && supplied.length <= 128) {
    return supplied;
  }
  return newRequestId();
}
