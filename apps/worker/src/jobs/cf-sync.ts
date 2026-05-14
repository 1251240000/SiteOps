/**
 * `cf-sync` job processor. The scheduler enqueues a single `sweep` per hour;
 * we iterate every active site with CF coordinates and pull recent
 * deployments via `cfService`.
 */
import { Worker, type ConnectionOptions } from 'bullmq';

import { integrations as integrationsSvc } from '@siteops/services';

import { getWorkerDb } from '../db.js';
import { getWorkerEnv } from '../env.js';
import { getWorkerLogger } from '../logger.js';
import { getQueueConnection } from '../queues.js';
import type { WorkerConnectionConfig } from '../queues.js';

const QUEUE_NAME = 'cf-sync';

export async function processCfSweep(): Promise<{
  sites: number;
  inserted: number;
  updated: number;
}> {
  const env = getWorkerEnv();
  const db = getWorkerDb();
  const logger = getWorkerLogger();
  if (!env.CF_API_TOKEN) {
    logger.info({ event: 'cf.skip' }, 'CF_API_TOKEN not configured; cf-sync skipped');
    return { sites: 0, inserted: 0, updated: 0 };
  }
  const summaries = await integrationsSvc.cfService.syncAll({ db, logger }, env.CF_API_TOKEN);
  return summaries.reduce(
    (acc, s) => ({
      sites: acc.sites + 1,
      inserted: acc.inserted + s.inserted,
      updated: acc.updated + s.updated,
    }),
    { sites: 0, inserted: 0, updated: 0 },
  );
}

export function startCfSyncWorker(config: WorkerConnectionConfig): Worker {
  const logger = getWorkerLogger();
  const worker = new Worker(QUEUE_NAME, async () => processCfSweep(), {
    connection: getQueueConnection(config) as unknown as ConnectionOptions,
    concurrency: 1,
  });
  worker.on('failed', (job, err) => {
    logger.warn(
      { event: 'cf.job_failed', jobId: job?.id, err: { message: err.message } },
      'cf-sync job failed',
    );
  });
  return worker;
}
