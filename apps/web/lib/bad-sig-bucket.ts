/**
 * Redis-backed `BadSigBucket` used by the inbound webhook routes.
 *
 * Implementation: per-key `INCR` + first-hit `EXPIRE`, mirroring the login
 * + API-key rate limiters. Lives in apps/web (not the services package)
 * because it depends on the app's Redis singleton.
 */
import type { webhooks as webhooksSvc } from '@siteops/services';

import { getLogger } from './logger';
import { getRedis } from './redis';

type BadSigBucket = webhooksSvc.BadSigBucket;

let cached: BadSigBucket | null = null;

export function getBadSigBucket(): BadSigBucket {
  if (cached) return cached;
  const log = getLogger();
  cached = {
    async hit(key, ttlSec, cap) {
      const redis = getRedis();
      if (redis.status === 'wait' || redis.status === 'end') {
        await redis.connect().catch(() => undefined);
      }
      const redisKey = `webhook:badsig:${key}`;
      const count = await redis.incr(redisKey);
      if (count === 1) {
        // First hit of a new window → arm the TTL. Don't bother checking
        // the result; if EXPIRE fails the TTL stays at -1 and the next
        // request will simply create a fresh window.
        await redis.expire(redisKey, ttlSec).catch((err) => {
          log.warn(
            { err: { message: err instanceof Error ? err.message : String(err) }, key },
            'bad-sig bucket EXPIRE failed; window may not reset',
          );
        });
      }
      return { count, over: count > cap };
    },
    async reset() {
      // We never actually need this in production; left as a no-op so the
      // type is satisfied. Tests use the in-memory bucket instead.
    },
  };
  return cached;
}

/** Test-only: drop the singleton so a fresh Redis client is picked up. */
export function __resetBadSigBucketForTests(): void {
  cached = null;
}
