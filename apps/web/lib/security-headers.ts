/**
 * Security response headers for the dashboard (T33).
 *
 * Two layers cooperate:
 *   1. Caddy (`infra/caddy/Caddyfile`) sets the edge-only headers — HSTS in
 *      particular only makes sense on a TLS termination point, so it lives
 *      there exclusively.
 *   2. This module is consumed by `middleware.ts` and runs on every HTML
 *      route (matcher excludes `/api/*`, `/_next/*`, `/favicon.ico`,
 *      `/healthz`). It owns CSP plus a defense-in-depth mirror of the
 *      non-HSTS edge headers so the dashboard stays protected even when
 *      run without Caddy in front (`pnpm dev`, behind a different proxy,
 *      etc.).
 *
 * CSP shape: tight `default-src 'self'` with `'unsafe-inline'` carve-outs
 * for Next 15 inline bootstrap chunks and Tailwind/next-themes runtime
 * style injection. Switching to nonce-based CSP needs the layout to thread
 * a per-request nonce into every `<script>` / `<style>` — tracked as a
 * follow-up after T33.
 *
 * In development we publish CSP as `Content-Security-Policy-Report-Only`
 * so that tightening rules in dev never actually breaks the page; prod
 * uses the enforcing header.
 */

export const SECURITY_HEADERS_NON_CSP: ReadonlyArray<readonly [string, string]> = [
  ['X-Content-Type-Options', 'nosniff'],
  ['X-Frame-Options', 'DENY'],
  ['Referrer-Policy', 'strict-origin-when-cross-origin'],
  ['Permissions-Policy', 'camera=(), microphone=(), geolocation=()'],
];

export const CSP_DIRECTIVES: ReadonlyArray<string> = [
  "default-src 'self'",
  // Next 15 inlines a bootstrap script; until we move to nonce-based CSP
  // we have to allow inline scripts.
  "script-src 'self' 'unsafe-inline'",
  // Tailwind utility classes plus next-themes set inline `style="..."`
  // attributes on hydration.
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  // Stronger than X-Frame-Options DENY for modern browsers; both go in.
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
];

export function getCspValue(): string {
  return CSP_DIRECTIVES.join('; ');
}

export type ApplySecurityHeadersOptions = {
  /** When true, publish the enforcing `Content-Security-Policy` header.
   *  When false, publish `Content-Security-Policy-Report-Only` so nothing
   *  is blocked locally. */
  isProd: boolean;
};

/**
 * Mutate `headers` in place to add the dashboard's standard security
 * envelope. Safe to call on a cloned `NextResponse.next()` headers bag.
 */
export function applySecurityHeaders(headers: Headers, opts: ApplySecurityHeadersOptions): void {
  for (const [name, value] of SECURITY_HEADERS_NON_CSP) {
    headers.set(name, value);
  }
  headers.set(
    opts.isProd ? 'Content-Security-Policy' : 'Content-Security-Policy-Report-Only',
    getCspValue(),
  );
}
