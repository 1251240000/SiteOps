/**
 * Domain normalization + validation.
 *
 * Inputs come from humans pasting things like `https://Example.COM/`, so we
 * accept a surprising amount of slop and produce one canonical form:
 *   - strip scheme (`https://`, `http://`)
 *   - strip leading/trailing whitespace
 *   - strip trailing dot (`example.com.` → `example.com`)
 *   - strip path / query / fragment / port
 *   - lowercase
 *
 * The output is the bare registrable hostname; uniqueness on `domains.domain`
 * is enforced at the DB level so callers don't have to re-check.
 *
 * Validation is deliberately conservative: a simple multi-label regex with
 * label-length + total-length caps. Punycoded labels (`xn--…`) pass. The
 * Public Suffix List isn't consulted — we don't need to know whether the
 * domain is a registrable TLD here, only that it's syntactically a hostname.
 */

/** RFC 1035-ish hostname check, post-normalisation. */
const HOSTNAME_RE = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export function normalizeDomain(input: string): string {
  let value = String(input).trim().toLowerCase();
  if (!value) return '';
  // Strip scheme.
  value = value.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
  // Strip everything after the first `/`, `?`, or `#`.
  const stop = value.search(/[/?#]/);
  if (stop !== -1) value = value.slice(0, stop);
  // Strip user-info.
  const at = value.lastIndexOf('@');
  if (at !== -1) value = value.slice(at + 1);
  // Strip port.
  const colon = value.indexOf(':');
  if (colon !== -1) value = value.slice(0, colon);
  // Strip trailing dots.
  value = value.replace(/\.+$/, '');
  return value;
}

export function isValidDomain(input: string): boolean {
  const value = normalizeDomain(input);
  if (!value) return false;
  // Reject obvious non-public hosts; primary-URL validation uses the same
  // banlist, but `domains` rows are richer (alt-domains, redirects) so we
  // only forbid the truly local ones here.
  if (value === 'localhost' || value.endsWith('.localhost') || value.endsWith('.local')) {
    return false;
  }
  return HOSTNAME_RE.test(value);
}
