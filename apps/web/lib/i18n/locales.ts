/**
 * Single source of truth for the locales the dashboard supports.
 *
 * Adding a locale requires:
 *   1. extend `SUPPORTED_LOCALES`
 *   2. drop a `messages/<locale>.json` matching the same key set
 *   3. update `pnpm i18n:check` (will fail until parity is restored)
 *
 * `DEFAULT_LOCALE` is what we render when the visitor has no cookie and
 * no usable `Accept-Language` header — kept as zh-CN per T28.
 */
export const SUPPORTED_LOCALES = ['zh-CN', 'en-US'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'zh-CN';

/** Cookie key used by the middleware + locale switcher. */
export const LOCALE_COOKIE = 'siteops_locale';

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}
