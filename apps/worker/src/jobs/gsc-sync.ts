/**
 * `gsc-sync` job. Pulls Search Console data once per day (D-3 lag built in).
 */
import { Worker, type ConnectionOptions } from 'bullmq';

import { integrations as integrationsSvc, alerts as alertsSvc } from '@siteops/services';

import { getWorkerDb } from '../db.js';
import { getWorkerEnv } from '../env.js';
import { getWorkerLogger } from '../logger.js';
import { getQueueConnection } from '../queues.js';
import type { WorkerConnectionConfig } from '../queues.js';

const QUEUE_NAME = 'gsc-sync';

export async function processGscSweep(): Promise<{ sites: number; rows: number }> {
  const env = getWorkerEnv();
  const db = getWorkerDb();
  const logger = getWorkerLogger();
  if (!env.GSC_OAUTH_CLIENT_ID || !env.GSC_OAUTH_CLIENT_SECRET || !env.GSC_OAUTH_REDIRECT_URI) {
    logger.info({ event: 'gsc.skip' }, 'GSC OAuth env not configured; gsc-sync skipped');
    return { sites: 0, rows: 0 };
  }
  const cipherKey = env.ALERT_CIPHER_KEY ?? 'dev-only-cipher-key-do-not-use-in-prod';
  const cipher = new alertsSvc.AlertCipher(cipherKey);
  const summaries = await integrationsSvc.gscService.syncAll(
    { db, logger, cipher },
    {
      clientId: env.GSC_OAUTH_CLIENT_ID,
      clientSecret: env.GSC_OAUTH_CLIENT_SECRET,
      redirectUri: env.GSC_OAUTH_REDIRECT_URI,
    },
  );
  return {
    sites: summaries.length,
    rows: summaries.reduce((acc, s) => acc + s.rowsWritten, 0),
  };
}

export function startGscSyncWorker(config: WorkerConnectionConfig): Worker {
  const logger = getWorkerLogger();
  const worker = new Worker(QUEUE_NAME, async () => processGscSweep(), {
    connection: getQueueConnection(config) as unknown as ConnectionOptions,
    concurrency: 1,
  });
  worker.on('failed', (job, err) => {
    logger.warn(
      { event: 'gsc.job_failed', jobId: job?.id, err: { message: err.message } },
      'gsc-sync job failed',
    );
  });
  return worker;
}
