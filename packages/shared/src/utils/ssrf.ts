/**
 * SSRF guard for outbound HTTP fetches initiated by the worker (uptime
 * checks, SEO audits, Lighthouse, etc.).
 *
 * Rejects any URL whose hostname resolves to (or *is*) a loopback / private /
 * link-local / multicast / broadcast address. The check is deliberately
 * synchronous on the literal hostname; the caller is expected to also pass
 * the resolved socket address to `assertNoPrivateIp` if it wants DNS-time
 * protection.
 *
 * The "primary URL" Zod schema in `schemas/sites.ts` already rejects the
 * obvious offenders at write time; this module is the runtime backstop for
 * worker fetches whose targets may have been added before the schema or via
 * a path that bypasses it (manual triggers, recursive sitemap entries…).
 */
import { isIP } from 'node:net';

/** Hostnames that must never be reachable from a worker fetch. */
const FORBIDDEN_HOSTS = new Set([
  'localhost',
  '0.0.0.0',
  'broadcasthost',
  'ip6-localhost',
  'ip6-loopback',
  '::1',
  '::',
]);

/** IPv4 ranges that must never be reachable from a worker fetch. */
const PRIVATE_IPV4_PREFIXES: ReadonlyArray<RegExp> = [
  /^0\./, // unspecified
  /^10\./, // private
  /^127\./, // loopback
  /^169\.254\./, // link-local
  /^172\.(?:1[6-9]|2\d|3[01])\./, // private
  /^192\.168\./, // private
  /^192\.0\.2\./, // TEST-NET-1
  /^198\.51\.100\./, // TEST-NET-2
  /^203\.0\.113\./, // TEST-NET-3
  /^22[4-9]\./,
  /^23\d\./, // multicast 224.0.0.0/4
  /^255\.255\.255\.255$/, // limited broadcast
];

/** IPv6 prefixes that must never be reachable from a worker fetch. */
const PRIVATE_IPV6_PREFIXES: ReadonlyArray<RegExp> = [
  /^fe80:/i, // link-local
  /^fc[0-9a-f]{2}:/i, // ULA
  /^fd[0-9a-f]{2}:/i, // ULA
  /^ff[0-9a-f]{2}:/i, // multicast
];

export type SsrfValidation = { ok: true } | { ok: false; reason: string };

/** Validate a URL string against the worker SSRF policy. */
export function validateOutboundUrl(rawUrl: string): SsrfValidation {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, reason: 'invalid_url' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, reason: 'scheme_not_allowed' };
  }
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!hostname) return { ok: false, reason: 'empty_host' };
  if (FORBIDDEN_HOSTS.has(hostname)) {
    return { ok: false, reason: 'forbidden_host' };
  }
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    return { ok: false, reason: 'forbidden_host' };
  }
  if (hostname.endsWith('.local') || hostname.endsWith('.internal')) {
    return { ok: false, reason: 'forbidden_host' };
  }

  const ipFamily = isIP(hostname);
  if (ipFamily === 4) {
    if (PRIVATE_IPV4_PREFIXES.some((re) => re.test(hostname))) {
      return { ok: false, reason: 'private_ipv4' };
    }
  } else if (ipFamily === 6) {
    if (PRIVATE_IPV6_PREFIXES.some((re) => re.test(hostname))) {
      return { ok: false, reason: 'private_ipv6' };
    }
    if (hostname === '::1' || hostname === '::') {
      return { ok: false, reason: 'private_ipv6' };
    }
  }
  return { ok: true };
}

/**
 * Throwing variant of `validateOutboundUrl`. Throws an `Error` whose
 * `message` is `ssrf_blocked:<reason>` so callers can pattern-match in
 * structured logs without parsing.
 */
export function assertOutboundUrl(rawUrl: string): void {
  const res = validateOutboundUrl(rawUrl);
  if (!res.ok) {
    throw new Error(`ssrf_blocked:${res.reason}`);
  }
}

/**
 * Validate a resolved socket address (IP literal) post-DNS. Use this after
 * resolving the hostname when the connector exposes the resolved address.
 */
export function assertNoPrivateIp(ip: string): void {
  const family = isIP(ip);
  if (family === 4) {
    if (PRIVATE_IPV4_PREFIXES.some((re) => re.test(ip))) {
      throw new Error('ssrf_blocked:private_ipv4');
    }
  } else if (family === 6) {
    if (PRIVATE_IPV6_PREFIXES.some((re) => re.test(ip)) || ip === '::1' || ip === '::') {
      throw new Error('ssrf_blocked:private_ipv6');
    }
  } else {
    throw new Error('ssrf_blocked:not_an_ip');
  }
}
