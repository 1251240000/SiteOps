/**
 * `uptime-check` job processor.
 *
 * Payload: `{ siteId: string }`. The processor delegates to
 * `uptimeService.checkAndRecord` which handles probing, persistence, and
 * health score recomputation. When the result is "ok=false" with enough
 * consecutive failures we additionally enqueue an `alert-fire` placeholder
 * job (the real alert pipeline is wired in T16).
 */
import { Worker, type Job } from 'bullmq';
import type { ConnectionOptions } from 'bullmq';

import { uptime as uptimeSvc } from '@siteops/services';

import { getWorkerDb } from '../db.js';
import { getWorkerLogger } from '../logger.js';
import { getQueue, getQueueConnection } from '../queues.js';
import type { WorkerConnectionConfig } from '../queues.js';

export type UptimeCheckJobData = {
  siteId: string;
  /** Optional override URL (manual checks); falls back to `site.primaryUrl`. */
  url?: string;
};

export const UPTIME_FAILURE_ALERT_THRESHOLD = 3;

export async function processUptimeCheck(
  job: Job<UptimeCheckJobData>,
  config: WorkerConnectionConfig,
): Promise<{ ok: boolean; consecutiveFailures: number; healthScore: number }> {
  const logger = getWorkerLogger();
  const db = getWorkerDb();
  const data = job.data;
  if (!data?.siteId) {
    throw new Error('uptime-check: missing siteId');
  }
  const result = await uptimeSvc.uptimeService.checkAndRecord(
    { db, logger },
    data.siteId,
    data.url,
  );

  if (!result.check.ok && result.consecutiveFailures >= UPTIME_FAILURE_ALERT_THRESHOLD) {
    try {
      const queue = getQueue('alert-fire', config);
      await queue.add(
        'uptime-failure',
        {
          ruleMetric: 'uptime',
          siteId: data.siteId,
          value: result.consecutiveFailures,
          message: `Uptime check failed ${result.consecutiveFailures}× in a row`,
        },
        { jobId: `uptime:${data.siteId}` },
      );
    } catch (err) {
      logger.warn(
        { err: { message: err instanceof Error ? err.message : String(err) } },
        'failed to enqueue alert-fire placeholder',
      );
    }
  }

  return {
    ok: result.check.ok,
    consecutiveFailures: result.consecutiveFailures,
    healthScore: result.newHealthScore,
  };
}

/** Start a long-lived BullMQ Worker consuming `uptime-check` jobs. */
export function startUptimeWorker(config: WorkerConnectionConfig): Worker<UptimeCheckJobData> {
  const logger = getWorkerLogger();
  const worker = new Worker<UptimeCheckJobData>(
    'uptime-check',
    (job) => processUptimeCheck(job, config),
    {
      connection: getQueueConnection(config) as unknown as ConnectionOptions,
      concurrency: 20,
      autorun: true,
    },
  );
  worker.on('failed', (job, err) => {
    logger.warn(
      {
        event: 'uptime.job_failed',
        jobId: job?.id,
        siteId: job?.data?.siteId,
        err: { message: err.message },
      },
      'uptime-check job failed',
    );
  });
  return worker;
}
