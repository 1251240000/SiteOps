import { createLogger, type Logger } from '@siteops/shared';

import { getWorkerEnv } from './env.js';

let cached: Logger | undefined;

export function getWorkerLogger(): Logger {
  if (cached) return cached;
  const env = getWorkerEnv();
  cached = createLogger({
    name: 'siteops-worker',
    level: env.LOG_LEVEL,
    bindings: { app: 'worker', env: env.NODE_ENV },
  });
  return cached;
}

export type { Logger };
