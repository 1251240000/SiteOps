/**
 * Edge-safe Auth.js config.
 *
 * `middleware.ts` imports this module to gate `/(dashboard)` traffic on the
 * Edge runtime. Anything Node-only — DB driver, bcrypt — must live in
 * `lib/auth.ts` and never be imported here, otherwise the middleware bundle
 * will fail to compile.
 */
import type { NextAuthConfig } from 'next-auth';

/** Protected URL prefixes. Anything matching is gated by the middleware. */
const PROTECTED_PREFIXES = [
  '/sites',
  '/traffic',
  '/revenue',
  '/roi',
  '/domains',
  '/deployments',
  '/errors',
  '/alerts',
  '/integrations',
  '/agent-runs',
  '/tasks',
  '/webhooks',
  '/settings',
  // `/admin/*` is reserved for future ops UIs (e.g. BullMQ Bull-Board mount).
  // Listing it here means *any* future handler under that prefix inherits
  // the admin-session redirect — no risk of accidentally mounting an
  // un-authed dashboard.
  '/admin',
];

export function isProtectedPath(pathname: string): boolean {
  if (pathname === '/') return true;
  return PROTECTED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export const authConfig = {
  // Auth.js will redirect unauthenticated requests here (Set via `pages`).
  pages: { signIn: '/login' },
  session: {
    strategy: 'jwt',
    // 7 days, per T06 spec.
    maxAge: 60 * 60 * 24 * 7,
  },
  trustHost: true,
  // Providers are declared in `lib/auth.ts` (Node runtime) where Credentials
  // can call into the DB. Middleware doesn't need them: it only checks for
  // the presence of a valid JWT session cookie.
  providers: [],
  callbacks: {
    /**
     * Decides whether a request is allowed through.
     *
     * IMPORTANT: when `middleware.ts` wraps Auth with `auth((req) => …)`,
     * next-auth's `handleAuth` runs the user middleware whenever this
     * callback returns a boolean — the built-in unauthorized redirect is
     * only triggered when no wrapper is provided. To stay correct in both
     * shapes we must return an explicit `Response.redirect(...)` for the
     * unauthorized case rather than `false`.
     */
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user;
      const path = nextUrl.pathname;
      const onLogin = path === '/login' || path.startsWith('/login/');

      if (onLogin) {
        // Bounce already-logged-in users off the login page.
        if (isLoggedIn) {
          const next = new URL('/', nextUrl);
          return Response.redirect(next);
        }
        return true;
      }
      if (!isProtectedPath(path)) return true;
      if (isLoggedIn) return true;

      // Unauthenticated request to a protected path → redirect to /login
      // with a relative `callbackUrl` so `safeCallbackUrl` accepts it.
      const signInUrl = new URL('/login', nextUrl);
      const dest = `${nextUrl.pathname}${nextUrl.search}`;
      if (dest && dest !== '/') signInUrl.searchParams.set('callbackUrl', dest);
      return Response.redirect(signInUrl);
    },
    /**
     * Stamp the user id onto the JWT at sign-in. Auth.js's default JWT
     * callback already copies `name` / `email` / `picture` from the User
     * object into the token, so we only need to set `sub` ourselves.
     */
    async jwt({ token, user }) {
      if (user && typeof user.id === 'string' && user.id.length > 0) {
        token.sub = user.id;
      }
      return token;
    },
    /** Surface `id` on the Session object the React/API consumers see. */
    async session({ session, token }) {
      if (session.user && typeof token.sub === 'string') {
        session.user.id = token.sub;
      }
      return session;
    },
  },
} satisfies NextAuthConfig;
