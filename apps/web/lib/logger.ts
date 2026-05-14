import { createLogger, type Logger } from '@siteops/shared';

import { getEnv } from './env';

let cached: Logger | undefined;

/** Process-wide pino logger, bound with `app=web` and `LOG_LEVEL`. */
export function getLogger(): Logger {
  if (cached) return cached;
  const env = getEnv();
  cached = createLogger({
    name: 'siteops-web',
    level: env.LOG_LEVEL,
    bindings: { app: 'web', env: env.NODE_ENV },
  });
  return cached;
}

export type { Logger };
