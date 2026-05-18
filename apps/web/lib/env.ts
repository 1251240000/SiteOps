/**
 * Lazy, validated env access for `apps/web`.
 *
 * The schema is parsed exactly once on first call to `getEnv()`. Module-top
 * level parsing is deliberately avoided so `next build` (which evaluates
 * module code for route discovery) doesn't blow up when only a subset of
 * runtime env vars is provided at image-build time.
 *
 * In `production`, `AUTH_SECRET` is mandatory; in dev/test we fall back to a
 * fixed stub so `pnpm dev` works out of the box without manual setup.
 */
import { AppError, parseEnv, z } from '@siteops/shared';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  AUTH_SECRET: z.string().min(1).optional(),
  AUTH_URL: z.string().url().optional(),
  /** Max successful credentials submissions per IP per minute. */
  LOGIN_RATE_LIMIT_PER_MIN: z.coerce.number().int().positive().default(5),
  /**
   * Max API requests per minute, per `api_keys.id`. Sliding 60s window
   * implemented in Redis. Defaults to 600 (10 rps sustained), which matches
   * what the M5 task-queue pull loop and Agent runners need.
   * On Redis outage we fail *open* — same logic as login rate limit.
   */
  API_KEY_RATE_LIMIT_PER_MIN: z.coerce.number().int().positive().default(600),

  // ---- M3 integration credentials (all optional). Routes return a 400
  // ---- "not configured" envelope if the relevant vars are missing. ----
  CF_API_TOKEN: z.string().min(1).optional(),
  GH_TOKEN: z.string().min(1).optional(),
  GA4_SERVICE_ACCOUNT_JSON: z.string().min(1).optional(),
  PLAUSIBLE_API_KEY: z.string().min(1).optional(),
  GSC_OAUTH_CLIENT_ID: z.string().min(1).optional(),
  GSC_OAUTH_CLIENT_SECRET: z.string().min(1).optional(),
  GSC_OAUTH_REDIRECT_URI: z.string().url().optional(),
  ADSENSE_OAUTH_CLIENT_ID: z.string().min(1).optional(),
  ADSENSE_OAUTH_CLIENT_SECRET: z.string().min(1).optional(),
  ADSENSE_OAUTH_REDIRECT_URI: z.string().url().optional(),
  ADSENSE_ACCOUNT_NAME: z.string().min(1).optional(),

  // ---- M5 webhook receivers (T27). Routes return 503 `webhook_not_configured`
  // ---- when the relevant var is missing. Minimum 16 chars to discourage
  // ---- "tooth" / "password123" tier secrets. ----
  CF_WEBHOOK_SECRET: z.string().min(16).optional(),
  GH_WEBHOOK_SECRET: z.string().min(16).optional(),
});

export type Env = z.infer<typeof envSchema> & { AUTH_SECRET: string };

let cached: Env | undefined;

export function getEnv(): Env {
  if (cached) return cached;
  const parsed = parseEnv(envSchema, process.env);
  if (parsed.NODE_ENV === 'production' && !parsed.AUTH_SECRET) {
    throw new AppError('AUTH_SECRET is required in production', {
      code: 'invalid_env',
      status: 500,
      details: { issues: [{ path: 'AUTH_SECRET', message: 'Required in production' }] },
    });
  }
  cached = {
    ...parsed,
    AUTH_SECRET: parsed.AUTH_SECRET ?? 'dev-only-auth-secret-do-not-use-in-prod',
  };
  return cached;
}

/** Test-only escape hatch; clears the cached env so a new `getEnv()` re-reads. */
export function __resetEnvForTests(): void {
  cached = undefined;
}
