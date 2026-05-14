/**
 * `gh-sync` job. Identical shape to `cf-sync`; delegates to ghService.
 */
import { Worker, type ConnectionOptions } from 'bullmq';

import { integrations as integrationsSvc } from '@siteops/services';

import { getWorkerDb } from '../db.js';
import { getWorkerEnv } from '../env.js';
import { getWorkerLogger } from '../logger.js';
import { getQueueConnection } from '../queues.js';
import type { WorkerConnectionConfig } from '../queues.js';

const QUEUE_NAME = 'gh-sync';

export async function processGhSweep(): Promise<{
  sites: number;
  inserted: number;
  updated: number;
}> {
  const env = getWorkerEnv();
  const db = getWorkerDb();
  const logger = getWorkerLogger();
  if (!env.GH_TOKEN) {
    logger.info({ event: 'gh.skip' }, 'GH_TOKEN not configured; gh-sync skipped');
    return { sites: 0, inserted: 0, updated: 0 };
  }
  const summaries = await integrationsSvc.ghService.syncAll({ db, logger }, env.GH_TOKEN);
  return summaries.reduce(
    (acc, s) => ({
      sites: acc.sites + 1,
      inserted: acc.inserted + s.inserted,
      updated: acc.updated + s.updated,
    }),
    { sites: 0, inserted: 0, updated: 0 },
  );
}

export function startGhSyncWorker(config: WorkerConnectionConfig): Worker {
  const logger = getWorkerLogger();
  const worker = new Worker(QUEUE_NAME, async () => processGhSweep(), {
    connection: getQueueConnection(config) as unknown as ConnectionOptions,
    concurrency: 1,
  });
  worker.on('failed', (job, err) => {
    logger.warn(
      { event: 'gh.job_failed', jobId: job?.id, err: { message: err.message } },
      'gh-sync job failed',
    );
  });
  return worker;
}
