/**
 * Tiny IP- / api-key-keyed sliding window for login + agent traffic.
 *
 * Implementation: `INCR` a Redis counter that is `EXPIRE`d on the first
 * increment of each window. Good enough for "5 attempts / 60s" — at higher
 * volumes we'd switch to a token-bucket Lua script.
 *
 * Failure modes (T31):
 *   1. Redis throws → fall back to the per-process LRU window in
 *      `local-window.ts`. A single instance can still throttle a single
 *      source for the duration of the outage.
 *   2. Local window itself throws (shouldn't happen — pure JS map ops) →
 *      fail *open* as a last resort. Being unable to log in at all on a
 *      Redis outage would be strictly worse than briefly losing the
 *      throttle, so the final fallback stays "allow".
 */
import { getEnv } from './env';
import { localHit } from './local-window';
import { getLogger } from './logger';
import { getRedis } from './redis';

export type LoginRateLimitResult = {
  allowed: boolean;
  count: number;
  limit: number;
  retryAfterSec: number;
};

export type ApiKeyRateLimitResult = LoginRateLimitResult;

const WINDOW_SEC = 60;

/** Shared 60s sliding-window check. Falls back to local LRU on Redis errors. */
async function checkSlidingWindow(
  redisKey: string,
  limit: number,
  ctx: Record<string, unknown>,
): Promise<LoginRateLimitResult> {
  const log = getLogger();
  try {
    const redis = getRedis();
    if (redis.status === 'wait' || redis.status === 'end') {
      await redis.connect().catch(() => undefined);
    }
    const count = await redis.incr(redisKey);
    let ttl = WINDOW_SEC;
    if (count === 1) {
      await redis.expire(redisKey, WINDOW_SEC);
    } else {
      const t = await redis.ttl(redisKey);
      if (t > 0) ttl = t;
    }
    return {
      allowed: count <= limit,
      count,
      limit,
      retryAfterSec: ttl,
    };
  } catch (err) {
    // Primary (Redis) path failed; try the per-process LRU window.
    try {
      const local = localHit(redisKey, WINDOW_SEC, limit);
      const retryAfterSec = Math.max(1, Math.ceil((local.resetAtMs - Date.now()) / 1000));
      log.warn(
        {
          event: 'ratelimit.local_fallback',
          err: { message: err instanceof Error ? err.message : String(err) },
          ...ctx,
          count: local.count,
          limit,
        },
        'rate-limit Redis path failed; using per-process LRU fallback',
      );
      return {
        allowed: local.allowed,
        count: local.count,
        limit,
        retryAfterSec,
      };
    } catch (innerErr) {
      // Local window itself failed — should be impossible. Last-resort
      // fail-open so legit users can still log in during a degraded ops
      // event. This is intentionally noisy.
      log.error(
        {
          err: { message: innerErr instanceof Error ? innerErr.message : String(innerErr) },
          ...ctx,
        },
        'rate-limit local fallback also failed; failing open',
      );
      return { allowed: true, count: 0, limit, retryAfterSec: 0 };
    }
  }
}

export async function checkLoginRateLimit(ip: string): Promise<LoginRateLimitResult> {
  const env = getEnv();
  return checkSlidingWindow(`login:rl:${ip || 'unknown'}`, env.LOGIN_RATE_LIMIT_PER_MIN, { ip });
}

/**
 * Per-API-key sliding window. Keyed on `api_keys.id` so revoking and
 * re-issuing a key clears the budget; we don't key on plaintext (we don't
 * have it past `withApiKey`) nor on caller IP (which Agents may share).
 *
 * Caller passes the full authenticated key so we can apply the optional
 * `rate_limit_per_min` override (T38) without an extra DB round-trip — the
 * value lives on the key view returned by `verifyApiKey`. NULL on the row
 * falls back to the global `API_KEY_RATE_LIMIT_PER_MIN` env value.
 */
export type ApiKeyForRateLimit = {
  id: string;
  rateLimitPerMin: number | null;
};

export async function checkApiKeyRateLimit(
  apiKey: ApiKeyForRateLimit,
): Promise<ApiKeyRateLimitResult> {
  const env = getEnv();
  const limit = apiKey.rateLimitPerMin ?? env.API_KEY_RATE_LIMIT_PER_MIN;
  return checkSlidingWindow(`apikey:rl:${apiKey.id}`, limit, {
    apiKeyId: apiKey.id,
    rateLimitPerMin: apiKey.rateLimitPerMin,
  });
}
