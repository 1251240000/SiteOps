/**
 * `analytics-sync` job. Pulls GA4 + Plausible daily metrics into
 * `metrics_daily`. The relevant credential env vars are optional; the
 * processor reports which providers it ran for.
 */
import { Worker, type ConnectionOptions } from 'bullmq';

import { integrations as integrationsSvc } from '@siteops/services';
import { ga4 } from '@siteops/integrations';

import { getWorkerDb } from '../db.js';
import { getWorkerEnv } from '../env.js';
import { getWorkerLogger } from '../logger.js';
import { getQueueConnection } from '../queues.js';
import type { WorkerConnectionConfig } from '../queues.js';

const QUEUE_NAME = 'analytics-sync';

export async function processAnalyticsSweep(): Promise<{ ga4: number; plausible: number }> {
  const env = getWorkerEnv();
  const db = getWorkerDb();
  const logger = getWorkerLogger();
  const inputs: Parameters<typeof integrationsSvc.analyticsService.syncAll>[1] = {};
  if (env.GA4_SERVICE_ACCOUNT_JSON) {
    try {
      inputs.ga4ServiceAccount = ga4.parseServiceAccountEnv(env.GA4_SERVICE_ACCOUNT_JSON);
    } catch (err) {
      logger.warn(
        {
          event: 'analytics.parse_ga4_failed',
          err: { message: err instanceof Error ? err.message : String(err) },
        },
        'GA4 service account env unparseable; skipping GA4',
      );
    }
  }
  if (env.PLAUSIBLE_API_KEY) inputs.plausibleApiKey = env.PLAUSIBLE_API_KEY;
  if (!inputs.ga4ServiceAccount && !inputs.plausibleApiKey) {
    logger.info({ event: 'analytics.skip' }, 'no analytics credentials configured; skipped');
    return { ga4: 0, plausible: 0 };
  }
  const summaries = await integrationsSvc.analyticsService.syncAll({ db, logger }, inputs);
  return {
    ga4: summaries.filter((s) => s.provider === 'ga4').length,
    plausible: summaries.filter((s) => s.provider === 'plausible').length,
  };
}

export function startAnalyticsSyncWorker(config: WorkerConnectionConfig): Worker {
  const logger = getWorkerLogger();
  const worker = new Worker(QUEUE_NAME, async () => processAnalyticsSweep(), {
    connection: getQueueConnection(config) as unknown as ConnectionOptions,
    concurrency: 1,
  });
  worker.on('failed', (job, err) => {
    logger.warn(
      { event: 'analytics.job_failed', jobId: job?.id, err: { message: err.message } },
      'analytics-sync job failed',
    );
  });
  return worker;
}
