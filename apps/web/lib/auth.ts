/**
 * Node-runtime Auth.js wiring.
 *
 * This module is where `Credentials.authorize()` actually talks to the DB
 * and bcrypt, so it must never be imported from middleware (Edge runtime).
 * Use `lib/auth.config.ts` there instead.
 */
import NextAuth, { type NextAuthConfig } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { z } from 'zod';

import { auth as authService } from '@siteops/services';

import { authConfig } from './auth.config';
import { getDb } from './db';
import { getLogger } from './logger';
import { checkLoginRateLimit } from './rate-limit';

const loginSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(1024),
});

/** Random 200–500ms jitter to flatten password-failure timing. */
function jitter(): Promise<void> {
  const ms = 200 + Math.floor(Math.random() * 300);
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Best-effort client IP extraction; the Edge proxy is expected to set XFF. */
function getClientIp(req: Request | undefined): string {
  const headers = req?.headers;
  if (!headers) return 'unknown';
  const xff = headers.get('x-forwarded-for');
  if (xff) {
    const first = xff.split(',')[0];
    if (first) return first.trim();
  }
  const real = headers.get('x-real-ip');
  if (real) return real.trim();
  return 'unknown';
}

/**
 * `AUTH_SECRET` is intentionally NOT read at module load: pulling it through
 * `getEnv()` here triggers Zod env validation on every `next build` page-data
 * collection (which doesn't get the runtime env injected). Auth.js v5 auto-
 * detects `process.env.AUTH_SECRET` when the request actually arrives, and
 * fail-fast for prod is handled inside `getEnv()` the first time anything
 * server-side touches it (logger, DB, rate limit — all per-request).
 */
const nodeConfig: NextAuthConfig = {
  ...authConfig,
  providers: [
    Credentials({
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials, request) {
        const log = getLogger().child({ op: 'login' });
        const ip = getClientIp(request);

        const rate = await checkLoginRateLimit(ip);
        if (!rate.allowed) {
          log.warn({ ip, count: rate.count, limit: rate.limit }, 'login rate-limited');
          await jitter();
          return null;
        }

        const parsed = loginSchema.safeParse(credentials);
        if (!parsed.success) {
          await jitter();
          return null;
        }

        try {
          const user = await authService.verifyAdminPassword(getDb(), parsed.data);
          if (!user) {
            log.info({ ip }, 'login failed');
            await jitter();
            return null;
          }
          log.info({ ip, userId: user.id, role: user.role }, 'login ok');
          return {
            id: user.id,
            email: user.email,
            name: user.name,
            role: user.role as 'admin' | 'operator' | 'viewer',
          };
        } catch (err) {
          log.error(
            { err: { message: err instanceof Error ? err.message : String(err) } },
            'login error',
          );
          await jitter();
          return null;
        }
      },
    }),
  ],
};

export const { auth, handlers, signIn, signOut } = NextAuth(nodeConfig);
