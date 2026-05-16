/**
 * Worker process env. Validated lazily so tests can stub fields without a
 * full real connection string.
 */
import { AppError, parseEnv, z } from '@siteops/shared';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  /** Encryption key for alert channel config (T16). 32 bytes hex/base64. */
  ALERT_CIPHER_KEY: z.string().min(1).optional(),
  /** Where to write raw audit reports (SEO HTML, LHR JSON). */
  AUDIT_DATA_DIR: z.string().default('/var/lib/siteops/audits'),
  /** Where to write Lighthouse reports. */
  LIGHTHOUSE_DATA_DIR: z.string().default('/var/lib/siteops/lighthouse'),
  /** Lighthouse runner mode. `stub` ships deterministic placeholder scores,
   * `real` boots Chromium via the optional `lighthouse` + `chrome-launcher`
   * dependencies. Production images set this to `real`. */
  LIGHTHOUSE_RUNNER: z.enum(['stub', 'real']).default('stub'),
  /** Uptime check default interval (minutes). */
  UPTIME_DEFAULT_INTERVAL_MIN: z.coerce.number().int().min(1).max(60).default(5),

  // ---- M3 integrations (all optional — the relevant scheduler short-
  // ---- circuits when its token isn't configured). ----
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
});

export type WorkerEnv = z.infer<typeof envSchema>;

let cached: WorkerEnv | undefined;

export function getWorkerEnv(): WorkerEnv {
  if (cached) return cached;
  cached = parseEnv(envSchema, process.env);
  if (cached.NODE_ENV === 'production' && !cached.ALERT_CIPHER_KEY) {
    throw new AppError('ALERT_CIPHER_KEY is required in production', {
      code: 'invalid_env',
      status: 500,
    });
  }
  return cached;
}

/** Test-only escape hatch. */
export function __resetWorkerEnvForTests(): void {
  cached = undefined;
}
