/**
 * Edge-runtime middleware combining two responsibilities:
 *
 *   1. Gate `/(dashboard)` routes behind a valid session cookie. The rule
 *      lives in `authConfig.callbacks.authorized`; if it returns false /
 *      a redirect Response, Auth.js short-circuits before reaching us.
 *   2. Seed `siteops_locale` cookie when missing so the next-intl request
 *      config (`lib/i18n/request.ts`) can pick a catalog deterministically
 *      on the very first paint. We never overwrite an existing cookie —
 *      explicit user choice via the locale switcher is sticky.
 *
 * IMPORTANT: this file may only import the edge-safe Auth config — it must
 * NOT pull in `lib/auth.ts` (which imports the postgres driver and bcrypt).
 */
import NextAuth from 'next-auth';
import { NextResponse } from 'next/server';

import { authConfig } from './lib/auth.config';
import { LOCALE_COOKIE } from './lib/i18n/locales';
import { pickLocale } from './lib/i18n/pick-locale';

const { auth } = NextAuth(authConfig);

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
  return res;
});

export const config = {
  // Skip everything Auth.js owns, static assets, and the public-API surface
  // (which has its own session/API-key checks via `withApi` / `withApiKey`).
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|healthz|login).*)'],
};
