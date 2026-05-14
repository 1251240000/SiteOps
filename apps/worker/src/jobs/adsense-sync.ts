/**
 * `adsense-sync` job. Pulls yesterday's AdSense report into `adsense_daily`.
 */
import { Worker, type ConnectionOptions } from 'bullmq';

import { integrations as integrationsSvc, alerts as alertsSvc } from '@siteops/services';

import { getWorkerDb } from '../db.js';
import { getWorkerEnv } from '../env.js';
import { getWorkerLogger } from '../logger.js';
import { getQueueConnection } from '../queues.js';
import type { WorkerConnectionConfig } from '../queues.js';

const QUEUE_NAME = 'adsense-sync';

export async function processAdsenseSweep(): Promise<{
  rowsFetched: number;
  rowsWritten: number;
}> {
  const env = getWorkerEnv();
  const db = getWorkerDb();
  const logger = getWorkerLogger();
  if (
    !env.ADSENSE_OAUTH_CLIENT_ID ||
    !env.ADSENSE_OAUTH_CLIENT_SECRET ||
    !env.ADSENSE_OAUTH_REDIRECT_URI ||
    !env.ADSENSE_ACCOUNT_NAME
  ) {
    logger.info(
      { event: 'adsense.skip' },
      'AdSense OAuth env not configured; adsense-sync skipped',
    );
    return { rowsFetched: 0, rowsWritten: 0 };
  }
  const cipherKey = env.ALERT_CIPHER_KEY ?? 'dev-only-cipher-key-do-not-use-in-prod';
  const cipher = new alertsSvc.AlertCipher(cipherKey);
  const summary = await integrationsSvc.adsenseService.syncDaily(
    { db, logger, cipher },
    {
      clientId: env.ADSENSE_OAUTH_CLIENT_ID,
      clientSecret: env.ADSENSE_OAUTH_CLIENT_SECRET,
      redirectUri: env.ADSENSE_OAUTH_REDIRECT_URI,
    },
    env.ADSENSE_ACCOUNT_NAME,
  );
  return { rowsFetched: summary.rowsFetched, rowsWritten: summary.rowsWritten };
}

export function startAdsenseSyncWorker(config: WorkerConnectionConfig): Worker {
  const logger = getWorkerLogger();
  const worker = new Worker(QUEUE_NAME, async () => processAdsenseSweep(), {
    connection: getQueueConnection(config) as unknown as ConnectionOptions,
    concurrency: 1,
  });
  worker.on('failed', (job, err) => {
    logger.warn(
      { event: 'adsense.job_failed', jobId: job?.id, err: { message: err.message } },
      'adsense-sync job failed',
    );
  });
  return worker;
}
