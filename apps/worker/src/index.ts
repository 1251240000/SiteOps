/**
 * Worker process entrypoint.
 *
 * Boots one BullMQ Worker per queue (uptime, ssl, seo, lighthouse, alert,
 * housekeeping) plus the schedulers that register their repeatables. Each
 * `start*` helper is idempotent — calling it twice within the same process
 * is a programmer error but won't corrupt Redis state.
 *
 * Graceful shutdown (T32): on SIGTERM/SIGINT we
 *   1. flip `shutdownState` so any long-running processor can short-circuit,
 *   2. await every BullMQ `Worker.close()` (which lets the current job
 *      finish naturally),
 *   3. drain any extra promises tracked via `shutdownState.track()` up to
 *      `WORKER_SHUTDOWN_TIMEOUT_MS` (default 30s),
 *   4. close queues + Redis, log `worker.exit`, then `process.exit(0)`.
 * A second SIGTERM mid-drain is no-oped to avoid cascading exits.
 */
import type { Worker } from 'bullmq';

import { lighthouse as lighthouseIntegration } from '@siteops/integrations';

import { getWorkerEnv } from './env.js';
import { getWorkerLogger } from './logger.js';
import { ALL_QUEUES, closeQueues } from './queues.js';
import type { WorkerConnectionConfig } from './queues.js';
import { shutdownState } from './shutdown.js';
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

let shutdownStarted = false;

async function shutdown(signal: string): Promise<void> {
  if (shutdownStarted) return;
  shutdownStarted = true;
  const logger = getWorkerLogger();
  const env = getWorkerEnv();
  shutdownState.signal();
  logger.info(
    { event: 'worker.shutdown_start', signal, inFlight: shutdownState.metrics().inFlight },
    'draining',
  );
  // Step 1: BullMQ workers — `.close()` resolves only after the in-flight
  // job (if any) has finished or BullMQ's own timeout has elapsed.
  await Promise.allSettled(workers.map((w) => w.close()));
  // Step 2: extra tracked promises (sweeps / fan-outs that aren't bound to
  // a single BullMQ job). Bounded by env so a wedged operation can't pin
  // the container forever.
  const drainStartedMs = Date.now();
  await shutdownState.drain(env.WORKER_SHUTDOWN_TIMEOUT_MS);
  const drainElapsed = Date.now() - drainStartedMs;
  const remaining = shutdownState.metrics().inFlight;
  if (remaining > 0) {
    logger.warn(
      {
        event: 'worker.shutdown_timeout',
        signal,
        remaining,
        drainTimeoutMs: env.WORKER_SHUTDOWN_TIMEOUT_MS,
        drainElapsedMs: drainElapsed,
      },
      'drain timeout — exiting with tracked promises still pending',
    );
  }
  await closeQueues();
  logger.info({ event: 'worker.exit', signal, drainElapsedMs: drainElapsed }, 'goodbye');
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
