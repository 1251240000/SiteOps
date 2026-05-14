/**
 * Lightweight BullMQ *producer* surface used by API routes (e.g. the
 * "trigger uptime check now" button). The full worker registry lives in
 * `apps/worker/src/queues.ts`; we re-implement the producer side here so
 * the web app doesn't need to depend on the worker package.
 */
import { Queue, type ConnectionOptions } from 'bullmq';
import IORedis, { type Redis } from 'ioredis';

import { getEnv } from './env';
import { getLogger } from './logger';

export type QueueName =
  | 'uptime-check'
  | 'ssl-domain-expiry'
  | 'seo-audit'
  | 'lighthouse-run'
  | 'alert-fire';

let connection: Redis | undefined;
const queues = new Map<QueueName, Queue>();

function getProducerConnection(): Redis {
  if (connection) return connection;
  const env = getEnv();
  const log = getLogger();
  connection = new IORedis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    lazyConnect: false,
  });
  connection.on('error', (err: Error) => {
    log.warn({ err: { message: err.message } }, 'redis producer error');
  });
  return connection;
}

export function getProducerQueue(name: QueueName): Queue {
  const cached = queues.get(name);
  if (cached) return cached;
  const q = new Queue(name, {
    connection: getProducerConnection() as unknown as ConnectionOptions,
    defaultJobOptions: {
      removeOnComplete: { age: 3600, count: 200 },
      removeOnFail: { age: 24 * 3600, count: 1000 },
      attempts: 2,
    },
  });
  queues.set(name, q);
  return q;
}
