import Redis from 'ioredis';

import { getEnv } from './env';
import { getLogger } from './logger';

let cached: Redis | undefined;

/**
 * Process-wide ioredis client. Opens lazily on first command so that the
 * `apps/web` process can still come up and serve `/healthz` if Redis is
 * temporarily unreachable at boot. BullMQ workers in `apps/worker` use a
 * separate connection by design (see T11).
 */
export function getRedis(): Redis {
  if (cached) return cached;
  const env = getEnv();
  const log = getLogger();
  const client = new Redis(env.REDIS_URL, {
    lazyConnect: true,
    maxRetriesPerRequest: 3,
    enableOfflineQueue: false,
  });
  client.on('error', (err) => {
    // Don't spam logs; pino's bindings dedupe per-bind, error shape varies.
    log.warn({ err: { message: err.message } }, 'redis client error');
  });
  cached = client;
  return cached;
}
