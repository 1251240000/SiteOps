/**
 * Tiny IP-keyed sliding window for login attempts.
 *
 * Implementation: `INCR` a Redis counter that is `EXPIRE`d on the first
 * increment of each window. Good enough for "5 attempts / 60s" — at higher
 * volumes we'd switch to a token-bucket Lua script.
 *
 * Failure mode: if Redis is unreachable we fail *open* (allow the attempt)
 * because being unable to log in at all on a Redis outage would be worse
 * than briefly losing rate limiting. The error is logged so it's still
 * surfaced in ops dashboards.
 */
import { getEnv } from './env';
import { getLogger } from './logger';
import { getRedis } from './redis';

export type LoginRateLimitResult = {
  allowed: boolean;
  count: number;
  limit: number;
  retryAfterSec: number;
};

const WINDOW_SEC = 60;

export async function checkLoginRateLimit(ip: string): Promise<LoginRateLimitResult> {
  const env = getEnv();
  const limit = env.LOGIN_RATE_LIMIT_PER_MIN;
  const key = `login:rl:${ip || 'unknown'}`;
  const log = getLogger();

  try {
    const redis = getRedis();
    if (redis.status === 'wait' || redis.status === 'end') {
      await redis.connect().catch(() => undefined);
    }
    const count = await redis.incr(key);
    let ttl = WINDOW_SEC;
    if (count === 1) {
      await redis.expire(key, WINDOW_SEC);
    } else {
      const t = await redis.ttl(key);
      if (t > 0) ttl = t;
    }
    return {
      allowed: count <= limit,
      count,
      limit,
      retryAfterSec: ttl,
    };
  } catch (err) {
    log.warn(
      { err: { message: err instanceof Error ? err.message : String(err) }, ip },
      'rate-limit check failed; failing open',
    );
    return { allowed: true, count: 0, limit, retryAfterSec: 0 };
  }
}
