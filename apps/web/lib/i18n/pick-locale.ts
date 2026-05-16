import { DEFAULT_LOCALE, isLocale, type Locale, SUPPORTED_LOCALES } from './locales';

export type PickLocaleInput = {
  /** Value of the `siteops_locale` cookie, if present. */
  cookie: string | undefined;
  /** Raw `Accept-Language` header, if present. */
  acceptLanguage: string | null | undefined;
};

/**
 * Decide which locale to render with. Pure function (no `Headers` / `Request`
 * dependency) so it's trivially unit-testable and reusable in middleware,
 * request config, and the cookie API route.
 *
 * Resolution order:
 *   1. cookie — explicit user choice always wins
 *   2. `Accept-Language` — best non-zero-quality match against SUPPORTED_LOCALES
 *      (matched on full tag first, then primary subtag fallback)
 *   3. `DEFAULT_LOCALE`
 */
export function pickLocale(input: PickLocaleInput): Locale {
  if (input.cookie && isLocale(input.cookie)) return input.cookie;

  const fromHeader = matchAcceptLanguage(input.acceptLanguage ?? '');
  if (fromHeader) return fromHeader;

  return DEFAULT_LOCALE;
}

/**
 * Naive RFC 4647 lookup: rank entries by `q`, then walk in order trying
 * full-tag and primary-subtag matches against our supported list. Returns
 * `null` if nothing matched (caller falls back to default).
 */
function matchAcceptLanguage(header: string): Locale | null {
  if (!header.trim()) return null;

  const ranked = header
    .split(',')
    .map((entry) => {
      const [tag = '', ...params] = entry.trim().split(';');
      const q = params
        .map((p) => p.trim())
        .find((p) => p.startsWith('q='))
        ?.slice(2);
      const quality = q ? Number(q) : 1;
      return { tag: tag.trim(), quality: Number.isFinite(quality) ? quality : 0 };
    })
    .filter((e) => e.tag.length > 0 && e.quality > 0)
    .sort((a, b) => b.quality - a.quality);

  for (const { tag } of ranked) {
    // Exact match (case-insensitive on the region subtag).
    const normalized = normalizeTag(tag);
    if (isLocale(normalized)) return normalized;

    // Primary subtag match: `en` → first supported `en-*`, etc.
    const primary = tag.split('-')[0]?.toLowerCase();
    if (!primary) continue;
    const fallback = SUPPORTED_LOCALES.find((l) => l.toLowerCase().startsWith(`${primary}-`));
    if (fallback) return fallback;
  }
  return null;
}

/** `zh-cn` → `zh-CN`, `en-us` → `en-US`. Untouched if not a known shape. */
function normalizeTag(tag: string): string {
  const [primary, region] = tag.split('-');
  if (!primary) return tag;
  if (!region) return primary.toLowerCase();
  return `${primary.toLowerCase()}-${region.toUpperCase()}`;
}
