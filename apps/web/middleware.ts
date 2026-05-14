/**
 * Edge-runtime middleware that gates `/(dashboard)` routes behind a valid
 * session cookie. The actual rule lives in `authConfig.callbacks.authorized`.
 *
 * IMPORTANT: this file may only import the edge-safe Auth config — it must
 * NOT pull in `lib/auth.ts` (which imports the postgres driver and bcrypt).
 */
import NextAuth from 'next-auth';

import { authConfig } from './lib/auth.config';

export const { auth: middleware } = NextAuth(authConfig);

export const config = {
  // Skip everything Auth.js owns, static assets, and the public-API surface
  // (which has its own session/API-key checks via `withApi` / `withApiKey`).
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|healthz|login).*)'],
};
