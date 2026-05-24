/**
 * Lightweight BullMQ *producer* surface used by API routes (e.g. the
 * "trigger uptime check now" button) plus the system-status read path.
 *
 * The full worker registry lives in `apps/worker/src/queues.ts`; we
 * re-implement the producer side here so the web app doesn't need to
 * depend on the worker package. Names are kept in sync between the two
 * via the shared `ALL_QUEUES` constant — adding a new queue requires
 * editing both lists.
 */
import { Queue, type ConnectionOptions } from 'bullmq';
import IORedis, { type Redis } from 'ioredis';

import { getEnv } from './env';
import { getLogger } from './logger';

/**
 * Every BullMQ queue the platform runs. Used by `/api/v1/system/jobs` to
 * surface per-queue depth + status counts, and by routes that want to
 * enqueue a one-shot job.
 *
 * Keep in sync with `apps/worker/src/queues.ts:ALL_QUEUES`.
 */
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

/** Snapshot of one queue's job counts for the system status endpoint. */
export type QueueStatusSnapshot = {
  name: QueueName;
  waiting: number;
  active: number;
  delayed: number;
  completed: number;
  failed: number;
};

/**
 * Read job counts for every queue in `ALL_QUEUES` in parallel.
 *
 * Each lookup is wrapped in its own try/catch so one broken queue doesn't
 * sink the whole response — a failing queue surfaces with all-zero counts
 * and an `error` string so the caller can render it as degraded rather
 * than disappear. We intentionally don't time-bound the BullMQ calls here:
 * the underlying Redis client already has its own timeouts.
 */
export async function getAllQueueStatuses(): Promise<
  Array<QueueStatusSnapshot & { error?: string }>
> {
  return Promise.all(
    ALL_QUEUES.map(async (name) => {
      try {
        const q = getProducerQueue(name);
        const counts = await q.getJobCounts('waiting', 'active', 'delayed', 'completed', 'failed');
        return {
          name,
          waiting: counts['waiting'] ?? 0,
          active: counts['active'] ?? 0,
          delayed: counts['delayed'] ?? 0,
          completed: counts['completed'] ?? 0,
          failed: counts['failed'] ?? 0,
        } satisfies QueueStatusSnapshot;
      } catch (err) {
        return {
          name,
          waiting: 0,
          active: 0,
          delayed: 0,
          completed: 0,
          failed: 0,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }),
  );
}
