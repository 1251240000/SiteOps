/**
 * Edge-runtime middleware combining three responsibilities:
 *
 *   1. Gate `/(dashboard)` routes behind a valid session cookie. The rule
 *      lives in `authConfig.callbacks.authorized`; if it returns false /
 *      a redirect Response, Auth.js short-circuits before reaching us.
 *   2. Seed `siteops_locale` cookie when missing so the next-intl request
 *      config (`lib/i18n/request.ts`) can pick a catalog deterministically
 *      on the very first paint. We never overwrite an existing cookie —
 *      explicit user choice via the locale switcher is sticky.
 *   3. Inject the dashboard's security response headers (T33). Caddy adds
 *      the same set plus HSTS at the edge; running them here too keeps
 *      `pnpm dev` and any non-Caddy proxy deployments protected.
 *
 * IMPORTANT: this file may only import the edge-safe Auth config — it must
 * NOT pull in `lib/auth.ts` (which imports the postgres driver and bcrypt).
 */
import NextAuth from 'next-auth';
import { NextResponse } from 'next/server';

import { authConfig } from './lib/auth.config';
import { LOCALE_COOKIE } from './lib/i18n/locales';
import { pickLocale } from './lib/i18n/pick-locale';
import { applySecurityHeaders } from './lib/security-headers';

const { auth } = NextAuth(authConfig);

const isProd = process.env.NODE_ENV === 'production';

export default auth((req) => {
  const res = NextResponse.next();
  if (!req.cookies.get(LOCALE_COOKIE)) {
    const locale = pickLocale({
      cookie: undefined,
      acceptLanguage: req.headers.get('accept-language'),
    });
    res.cookies.set(LOCALE_COOKIE, locale, {
      path: '/',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 365,
    });
  }
  applySecurityHeaders(res.headers, { isProd });
  return res;
});

export const config = {
  // Skip API (own auth + JSON, no CSP needed), Next static + image
  // pipelines (immutable + cache-friendly; CSP would be redundant noise),
  // favicon, liveness probe `/healthz`, and the public browser tracker bundle.
  // `/login` IS matched so it gets the same security envelope as the dashboard;
  // the page component itself bounces logged-in users away.
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|healthz|tracker.js).*)'],
};
