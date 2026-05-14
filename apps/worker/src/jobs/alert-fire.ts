/**
 * `alert-fire` job processor.
 *
 * Other monitoring jobs enqueue messages like
 *   { ruleMetric: 'uptime', siteId, value, message }
 * onto the `alert-fire` queue. This processor turns those into a metric
 * observation, calls `alertService.fire`, and lets the service handle the
 * rest (rule evaluation, dispatch, dedup).
 */
import { Worker, type ConnectionOptions, type Job } from 'bullmq';

import { alerts as alertsSvc } from '@siteops/services';

import { getWorkerDb } from '../db.js';
import { getWorkerEnv } from '../env.js';
import { getWorkerLogger } from '../logger.js';
import { getQueueConnection } from '../queues.js';
import type { WorkerConnectionConfig } from '../queues.js';

export type AlertFireJobData = {
  ruleMetric:
    | 'uptime'
    | 'ssl_expiry'
    | 'domain_expiry'
    | 'lighthouse_perf'
    | 'error_rate'
    | 'custom';
  siteId?: string | null;
  siteName?: string;
  value: number;
  message?: string;
};

function observationFor(data: AlertFireJobData) {
  switch (data.ruleMetric) {
    case 'uptime':
      return { metric: 'uptime' as const, consecutiveFailures: data.value };
    case 'ssl_expiry':
      return { metric: 'ssl_expiry' as const, daysRemaining: data.value };
    case 'domain_expiry':
      return { metric: 'domain_expiry' as const, daysRemaining: data.value };
    case 'lighthouse_perf':
      return { metric: 'lighthouse_perf' as const, score: data.value };
    case 'error_rate':
      return { metric: 'error_rate' as const, errorsInWindow: data.value };
    case 'custom':
    default:
      return { metric: 'custom' as const, value: data.value };
  }
}

export async function processAlertFire(
  job: Job<AlertFireJobData>,
): Promise<{ triggered: number; resolved: number }> {
  const env = getWorkerEnv();
  const logger = getWorkerLogger();
  const db = getWorkerDb();
  const cipherKey = env.ALERT_CIPHER_KEY ?? 'dev-only-cipher-key-do-not-use-in-prod';
  const cipher = new alertsSvc.AlertCipher(cipherKey);
  const { triggered, resolved } = await alertsSvc.alertService.fire(
    { db, logger, cipher },
    {
      siteId: job.data.siteId ?? null,
      ...(job.data.siteName ? { siteName: job.data.siteName } : {}),
      source: `worker:${job.name}`,
      observation: observationFor(job.data),
    },
  );
  return { triggered: triggered.length, resolved: resolved.length };
}

export function startAlertFireWorker(config: WorkerConnectionConfig): Worker<AlertFireJobData> {
  const logger = getWorkerLogger();
  const worker = new Worker<AlertFireJobData>('alert-fire', processAlertFire, {
    connection: getQueueConnection(config) as unknown as ConnectionOptions,
    concurrency: 4,
  });
  worker.on('failed', (job, err) => {
    logger.warn(
      {
        event: 'alert.job_failed',
        jobId: job?.id,
        err: { message: err.message },
      },
      'alert-fire job failed',
    );
  });
  return worker;
}
