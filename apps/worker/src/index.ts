/**
 * Worker process entrypoint.
 *
 * Boots one BullMQ Worker per queue (uptime, ssl, seo, lighthouse, alert,
 * housekeeping) plus the schedulers that register their repeatables. Each
 * `start*` helper is idempotent — calling it twice within the same process
 * is a programmer error but won't corrupt Redis state.
 *
 * Graceful shutdown: on SIGTERM/SIGINT we close every Worker (which lets in-
 * flight jobs finish), then close the queues + Redis connection.
 */
import type { Worker } from 'bullmq';

import { lighthouse as lighthouseIntegration } from '@siteops/integrations';

import { getWorkerEnv } from './env.js';
import { getWorkerLogger } from './logger.js';
import { ALL_QUEUES, closeQueues } from './queues.js';
import type { WorkerConnectionConfig } from './queues.js';
import { startAlertFireWorker } from './jobs/alert-fire.js';
import { startHousekeepingWorker } from './jobs/housekeeping.js';
import { startLighthouseWorker } from './jobs/lighthouse-run.js';
import { startSeoAuditWorker } from './jobs/seo-audit.js';
import { startSslWorker } from './jobs/ssl-domain-expiry.js';
import { startUptimeWorker } from './jobs/uptime-check.js';
import { startCfSyncWorker } from './jobs/cf-sync.js';
import { startGhSyncWorker } from './jobs/gh-sync.js';
import { startAnalyticsSyncWorker } from './jobs/analytics-sync.js';
import { startGscSyncWorker } from './jobs/gsc-sync.js';
import { startAdsenseSyncWorker } from './jobs/adsense-sync.js';
import { startHousekeepingScheduler } from './schedulers/housekeeping-scheduler.js';
import { startLighthouseScheduler } from './schedulers/lighthouse-scheduler.js';
import { startSeoAuditScheduler } from './schedulers/seo-audit-scheduler.js';
import { startSslScheduler } from './schedulers/ssl-domain-scheduler.js';
import { startUptimeScheduler } from './schedulers/uptime-scheduler.js';
import { startCfSyncScheduler } from './schedulers/cf-sync-scheduler.js';
import { startGhSyncScheduler } from './schedulers/gh-sync-scheduler.js';
import { startAnalyticsScheduler } from './schedulers/analytics-scheduler.js';
import { startGscSyncScheduler } from './schedulers/gsc-sync-scheduler.js';
import { startAdsenseSyncScheduler } from './schedulers/adsense-sync-scheduler.js';

const workers: Worker[] = [];

async function main(): Promise<void> {
  const env = getWorkerEnv();
  const logger = getWorkerLogger();
  const config: WorkerConnectionConfig = { redisUrl: env.REDIS_URL, logger };

  logger.info(
    { event: 'worker.boot', queues: [...ALL_QUEUES], lighthouseRunner: env.LIGHTHOUSE_RUNNER },
    'siteops worker starting',
  );

  if (env.LIGHTHOUSE_RUNNER === 'real') {
    try {
      lighthouseIntegration.registerLighthouseRunner(
        lighthouseIntegration.createRealLighthouseRunner(),
      );
      logger.info(
        { event: 'lighthouse.runner', mode: 'real' },
        'real Lighthouse runner registered',
      );
    } catch (err) {
      // Don't crash boot — fall back to the stub so the rest of the worker
      // (uptime, SSL, integrations, alerts) still ships data.
      logger.error(
        {
          event: 'lighthouse.runner_init_failed',
          err: { message: err instanceof Error ? err.message : String(err) },
        },
        'real Lighthouse runner init failed; falling back to stub',
      );
    }
  }

  // Per-queue consumers.
  workers.push(startUptimeWorker(config));
  workers.push(startSslWorker(config));
  workers.push(startSeoAuditWorker(config));
  workers.push(startLighthouseWorker(config));
  workers.push(startAlertFireWorker(config));
  workers.push(startHousekeepingWorker(config));
  workers.push(startCfSyncWorker(config));
  workers.push(startGhSyncWorker(config));
  workers.push(startAnalyticsSyncWorker(config));
  workers.push(startGscSyncWorker(config));
  workers.push(startAdsenseSyncWorker(config));

  // Schedulers (register repeatables; some also return workers).
  workers.push(await startUptimeScheduler(config));
  await startSslScheduler(config);
  await startSeoAuditScheduler(config);
  await startLighthouseScheduler(config);
  await startHousekeepingScheduler(config);
  await startCfSyncScheduler(config);
  await startGhSyncScheduler(config);
  await startAnalyticsScheduler(config);
  await startGscSyncScheduler(config);
  await startAdsenseSyncScheduler(config);

  logger.info({ event: 'worker.ready' }, 'siteops worker ready');
}

async function shutdown(signal: string): Promise<void> {
  const logger = getWorkerLogger();
  logger.info({ event: 'worker.shutdown', signal }, 'shutting down');
  await Promise.allSettled(workers.map((w) => w.close()));
  await closeQueues();
  process.exit(0);
}

process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});
process.on('SIGINT', () => {
  void shutdown('SIGINT');
});

if (process.env['VITEST'] !== 'true') {
  main().catch((err) => {
    const logger = getWorkerLogger();
    logger.error(
      { err: { message: err instanceof Error ? err.message : String(err) } },
      'worker boot failed',
    );
    process.exit(1);
  });
}

export { main as startWorker };
