/**
 * `lighthouse-run` job processor.
 *
 * Two job names share this queue: `lighthouse-sweep` (daily fanout) and
 * `run` (per-site). The actual runner is pluggable — by default it is the
 * stubbed one from `@siteops/integrations/lighthouse`, swap via
 * `registerLighthouseRunner()` before booting.
 */
import { Worker, type ConnectionOptions, type Job } from 'bullmq';

import { siteRepo } from '@siteops/db';
import { audits as auditsSvc } from '@siteops/services';

import { getWorkerDb } from '../db.js';
import { getWorkerEnv } from '../env.js';
import { getWorkerLogger } from '../logger.js';
import { getQueue, getQueueConnection } from '../queues.js';
import type { WorkerConnectionConfig } from '../queues.js';

export type LighthouseJobData = { siteId: string };

async function processSweep(config: WorkerConnectionConfig): Promise<{ enqueued: number }> {
  const db = getWorkerDb();
  const queue = getQueue('lighthouse-run', config);
  const sites = await siteRepo.listActive(db);
  for (const s of sites) {
    await queue.add(
      'run',
      { siteId: s.id },
      { jobId: `lh:${s.id}:${new Date().toISOString().slice(0, 10)}` },
    );
  }
  return { enqueued: sites.length };
}

async function processSingle(
  job: Job<LighthouseJobData>,
  config: WorkerConnectionConfig,
): Promise<{ auditRunId: string; performance: number }> {
  const env = getWorkerEnv();
  const db = getWorkerDb();
  const logger = getWorkerLogger();
  const { siteId } = job.data;
  const site = await siteRepo.getById(db, siteId);
  if (!site) throw new Error(`lighthouse: site ${siteId} not found`);
  const result = await auditsSvc.lighthouseService.runLighthouse(
    { db, logger, dataDir: env.LIGHTHOUSE_DATA_DIR },
    { siteId, siteUrl: site.primaryUrl },
  );
  if (result.scores.performance < 0.3) {
    try {
      const alertQueue = getQueue('alert-fire', config);
      await alertQueue.add(
        'lighthouse-perf',
        {
          ruleMetric: 'lighthouse_perf',
          siteId,
          value: result.scores.performance,
          message: `Lighthouse Performance ${(result.scores.performance * 100).toFixed(0)} for ${site.primaryUrl}`,
        },
        { jobId: `lh-perf:${siteId}` },
      );
    } catch (err) {
      logger.warn(
        { err: { message: err instanceof Error ? err.message : String(err) } },
        'failed to enqueue lighthouse_perf alert',
      );
    }
  }
  return { auditRunId: result.run.id, performance: result.scores.performance };
}

export function startLighthouseWorker(
  config: WorkerConnectionConfig,
): Worker<LighthouseJobData | Record<string, never>> {
  const logger = getWorkerLogger();
  const worker = new Worker<LighthouseJobData | Record<string, never>>(
    'lighthouse-run',
    async (job) => {
      if (job.name === 'lighthouse-sweep') return processSweep(config);
      return processSingle(job as Job<LighthouseJobData>, config);
    },
    {
      connection: getQueueConnection(config) as unknown as ConnectionOptions,
      concurrency: 1,
    },
  );
  worker.on('failed', (job, err) => {
    logger.warn(
      {
        event: 'lighthouse.job_failed',
        jobId: job?.id,
        jobName: job?.name,
        err: { message: err.message },
      },
      'lighthouse job failed',
    );
  });
  return worker;
}
