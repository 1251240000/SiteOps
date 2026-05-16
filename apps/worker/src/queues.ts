/**
 * BullMQ queue registry shared across schedulers, processors, and the API
 * server (which only produces). Each `getXxxQueue()` call returns the same
 * Queue instance for the lifetime of the process.
 *
 * Connection: a dedicated ioredis instance with `maxRetriesPerRequest: null`
 * — required by BullMQ for blocking commands.
 */
import { Queue, QueueEvents, type ConnectionOptions } from 'bullmq';
import IORedis, { type Redis } from 'ioredis';

import type { Logger } from '@siteops/shared';

export type QueueName =
  | 'uptime-check'
  | 'uptime-tick'
  | 'ssl-domain-expiry'
  | 'seo-audit'
  | 'lighthouse-run'
  | 'alert-fire'
  | 'housekeeping'
  | 'cf-sync'
  | 'gh-sync'
  | 'analytics-sync'
  | 'gsc-sync'
  | 'adsense-sync';

export const ALL_QUEUES: ReadonlyArray<QueueName> = [
  'uptime-check',
  'uptime-tick',
  'ssl-domain-expiry',
  'seo-audit',
  'lighthouse-run',
  'alert-fire',
  'housekeeping',
  'cf-sync',
  'gh-sync',
  'analytics-sync',
  'gsc-sync',
  'adsense-sync',
];

let connection: Redis | undefined;
const queues = new Map<QueueName, Queue>();
const events = new Map<QueueName, QueueEvents>();

export type WorkerConnectionConfig = {
  redisUrl: string;
  logger?: Pick<Logger, 'info' | 'warn' | 'error'>;
};

/**
 * Create (or return cached) ioredis connection suitable for BullMQ. The
 * underlying socket is configured per BullMQ docs (`maxRetriesPerRequest:
 * null`) so blocking commands stay healthy.
 */
export function getQueueConnection(config: WorkerConnectionConfig): Redis {
  if (connection) return connection;
  connection = new IORedis(config.redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    lazyConnect: false,
  });
  connection.on('error', (err: Error) => {
    config.logger?.warn({ err: { message: err.message } }, 'redis connection error (worker)');
  });
  return connection;
}

export function connectionOptions(config: WorkerConnectionConfig): {
  connection: ConnectionOptions;
} {
  return { connection: getQueueConnection(config) as unknown as ConnectionOptions };
}

export function getQueue(name: QueueName, config: WorkerConnectionConfig): Queue {
  const cached = queues.get(name);
  if (cached) return cached;
  const q = new Queue(name, {
    connection: getQueueConnection(config) as unknown as ConnectionOptions,
    defaultJobOptions: {
      removeOnComplete: { age: 3600, count: 1000 },
      removeOnFail: { age: 24 * 3600, count: 5000 },
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
    },
  });
  queues.set(name, q);
  return q;
}

export function getQueueEvents(name: QueueName, config: WorkerConnectionConfig): QueueEvents {
  const cached = events.get(name);
  if (cached) return cached;
  const qe = new QueueEvents(name, {
    connection: getQueueConnection(config) as unknown as ConnectionOptions,
  });
  events.set(name, qe);
  return qe;
}

/** Tear down every queue + connection. Use only in shutdown / tests. */
export async function closeQueues(): Promise<void> {
  await Promise.allSettled([
    ...Array.from(queues.values()).map((q) => q.close()),
    ...Array.from(events.values()).map((qe) => qe.close()),
  ]);
  queues.clear();
  events.clear();
  if (connection) {
    await connection.quit().catch(() => undefined);
    connection = undefined;
  }
}
