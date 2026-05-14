/**
 * Uptime scheduler.
 *
 * BullMQ exposes "repeatable jobs" that fire on a cron expression. We
 * register a single `uptime-tick` repeatable that runs every minute; the
 * processor enumerates active sites and dispatches one `uptime-check` per
 * site that is due (interval / minute math is in `dueSites`).
 *
 * Why not register N repeatables (one per site)? Because:
 *   - sites are dynamic; we'd have to deregister on archive and re-register
 *     on un-archive, which is racy across process restarts
 *   - per-site cron entries cost more in Redis than a single tick + fanout
 */
import { Worker, type Job } from 'bullmq';
import type { ConnectionOptions } from 'bullmq';
import pLimit from 'p-limit';

import { siteRepo } from '@siteops/db';

import { getWorkerDb } from '../db.js';
import { getWorkerEnv } from '../env.js';
import { getWorkerLogger } from '../logger.js';
import { getQueue, getQueueConnection } from '../queues.js';
import type { WorkerConnectionConfig } from '../queues.js';

const UPTIME_TICK_QUEUE = 'uptime-check';
const TICK_JOB_NAME = 'uptime-tick';

export type UptimeTickJobData = {
  /** Allow ad-hoc invocations to short-circuit the interval check. */
  forceAll?: boolean;
};

/** Returns site rows that are eligible to be probed in this tick. */
export async function dueSites(
  now: Date,
  intervalMin: number,
): Promise<Array<{ id: string; primaryUrl: string }>> {
  const db = getWorkerDb();
  const rows = await siteRepo.listActive(db);
  if (intervalMin <= 1) return rows;
  const bucket = Math.floor(now.getTime() / 60_000) % intervalMin;
  return rows.filter((_row, idx) => idx % intervalMin === bucket);
}

async function processTick(
  job: Job<UptimeTickJobData>,
  config: WorkerConnectionConfig,
): Promise<{ enqueued: number }> {
  const log = getWorkerLogger();
  const env = getWorkerEnv();
  const queue = getQueue(UPTIME_TICK_QUEUE, config);
  const now = new Date();
  const sites = job.data?.forceAll
    ? await dueSites(now, 1)
    : await dueSites(now, env.UPTIME_DEFAULT_INTERVAL_MIN);
  const limit = pLimit(20);
  await Promise.all(
    sites.map((s) =>
      limit(async () => {
        await queue.add(
          'check',
          { siteId: s.id },
          // Idempotency: one job per (siteId, minute) so overlapping schedulers
          // don't double-write.
          { jobId: `uptime:${s.id}:${Math.floor(now.getTime() / 60_000)}` },
        );
      }),
    ),
  );
  log.info({ event: 'uptime.tick', size: sites.length }, 'uptime tick dispatched');
  return { enqueued: sites.length };
}

/**
 * Register the repeatable `uptime-tick` job (idempotent — calling twice is
 * a no-op because BullMQ deduplicates by key) and start a worker that
 * consumes ticks.
 */
export async function startUptimeScheduler(
  config: WorkerConnectionConfig,
): Promise<Worker<UptimeTickJobData>> {
  const queue = getQueue(UPTIME_TICK_QUEUE, config);
  await queue.add(
    TICK_JOB_NAME,
    {},
    {
      repeat: { every: 60_000 },
      jobId: TICK_JOB_NAME,
      removeOnComplete: true,
      removeOnFail: true,
    },
  );

  const log = getWorkerLogger();
  const worker = new Worker<UptimeTickJobData>(
    UPTIME_TICK_QUEUE,
    async (job) => {
      if (job.name !== TICK_JOB_NAME) {
        // Not for us; the individual `check` processor handles those.
        return { enqueued: 0 };
      }
      return processTick(job, config);
    },
    {
      connection: getQueueConnection(config) as unknown as ConnectionOptions,
      concurrency: 1,
    },
  );
  worker.on('failed', (job, err) => {
    log.warn(
      { event: 'uptime.tick_failed', jobId: job?.id, err: { message: err.message } },
      'uptime tick failed',
    );
  });
  return worker;
}
