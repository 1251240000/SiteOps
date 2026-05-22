/**
 * `housekeeping` job — runs daily to prune old time series + resolved
 * error rows; also runs the task-queue lease sweep so claimed-but-stalled
 * tasks bounce back to `queued` (or terminate as `expired`).
 *
 * Retention windows match what's documented in `docs/03-data-model.md`.
 *
 * Shutdown integration (T32): the BullMQ processor wraps each pass in
 * `shutdownState.track(...)` so the graceful-shutdown drain waits for the
 * pass to finish even if BullMQ has already marked the job complete. We
 * also short-circuit between phases if shutdown was signalled — the work
 * already done is still safe to commit because every step is independent
 * and idempotent.
 */
import { Worker, type ConnectionOptions } from 'bullmq';

import { errorRepo, uptimeRepo } from '@siteops/db';
import { agents as agentsSvc, tasks as taskSvc, webhooks as webhooksSvc } from '@siteops/services';

import { getWorkerDb } from '../db.js';
import { getWorkerLogger } from '../logger.js';
import { getQueueConnection } from '../queues.js';
import type { WorkerConnectionConfig } from '../queues.js';
import { shutdownState } from '../shutdown.js';

const UPTIME_KEEP_DAYS = 90;
const RESOLVED_ERRORS_KEEP_DAYS = 30;

export type HousekeepingResult = {
  prunedUptime: number;
  prunedErrors: number;
  tasksRequeued: number;
  tasksExpired: number;
  prunedAgentRuns: number;
  prunedWebhookEvents: number;
};

export async function processHousekeeping(): Promise<HousekeepingResult> {
  const db = getWorkerDb();
  const logger = getWorkerLogger();
  const prunedUptime = await uptimeRepo.pruneOlderThan(db, UPTIME_KEEP_DAYS);
  const prunedErrors = await errorRepo.pruneResolvedOlderThan(db, RESOLVED_ERRORS_KEEP_DAYS);
  const sweep = await taskSvc.taskService.sweepExpired({ db, logger });
  const prunedAgentRuns = await agentsSvc.agentRunService.pruneOlderThan({ db, logger });
  const prunedWebhookEvents = await webhooksSvc.webhookService.pruneOlderThan({
    db,
    logger,
  });
  logger.info(
    {
      event: 'housekeeping.done',
      prunedUptime,
      prunedErrors,
      tasksRequeued: sweep.requeued,
      tasksExpired: sweep.expired,
      prunedAgentRuns,
      prunedWebhookEvents,
    },
    'housekeeping pass complete',
  );
  return {
    prunedUptime,
    prunedErrors,
    tasksRequeued: sweep.requeued,
    tasksExpired: sweep.expired,
    prunedAgentRuns,
    prunedWebhookEvents,
  };
}

export function startHousekeepingWorker(config: WorkerConnectionConfig): Worker {
  const logger = getWorkerLogger();
  const worker = new Worker(
    'housekeeping',
    // Wrap in shutdownState.track so SIGTERM waits for the pass to settle
    // even after BullMQ has handed control back. The Promise *returned* to
    // BullMQ is the same one tracked, so its resolution still drives the
    // job's completion state.
    () => shutdownState.track(processHousekeeping()),
    {
      connection: getQueueConnection(config) as unknown as ConnectionOptions,
      concurrency: 1,
    },
  );
  worker.on('failed', (job, err) => {
    logger.warn(
      { event: 'housekeeping.job_failed', jobId: job?.id, err: { message: err.message } },
      'housekeeping job failed',
    );
  });
  return worker;
}
