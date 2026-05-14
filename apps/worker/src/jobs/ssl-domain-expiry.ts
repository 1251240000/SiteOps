/**
 * `ssl-domain-expiry` job processor.
 *
 * Two job names share this queue:
 *   - `sweep`: scheduler-fired tick that fans out one `probe-one` per domain
 *   - `probe-one`: per-domain TLS probe + DB update
 */
import { Worker, type ConnectionOptions, type Job } from 'bullmq';

import { domainRepo, type Domain } from '@siteops/db';
import { domains as domainsSvc } from '@siteops/services';

import { getWorkerDb } from '../db.js';
import { getWorkerLogger } from '../logger.js';
import { getQueue, getQueueConnection } from '../queues.js';
import type { WorkerConnectionConfig } from '../queues.js';

const QUEUE_NAME = 'ssl-domain-expiry';

export type SslSweepJobData = { kind: 'sweep' };
export type SslProbeOneJobData = { kind: 'probe-one'; domainId: string };
export type SslJobData = SslSweepJobData | SslProbeOneJobData;

async function processSweep(config: WorkerConnectionConfig): Promise<{ enqueued: number }> {
  const db = getWorkerDb();
  const queue = getQueue(QUEUE_NAME, config);
  const rows = await domainRepo.listAll(db);
  for (const row of rows) {
    await queue.add(
      'probe-one',
      { kind: 'probe-one', domainId: row.id } satisfies SslProbeOneJobData,
      { jobId: `ssl:${row.id}:${new Date().toISOString().slice(0, 10)}` },
    );
  }
  return { enqueued: rows.length };
}

async function processProbeOne(
  data: SslProbeOneJobData,
  config: WorkerConnectionConfig,
): Promise<{ ok: boolean; sslDays: number | null }> {
  const logger = getWorkerLogger();
  const db = getWorkerDb();
  const row: Domain | null = await domainRepo.getById(db, data.domainId);
  if (!row) {
    logger.warn({ event: 'ssl.domain_missing', domainId: data.domainId }, 'domain missing');
    return { ok: false, sslDays: null };
  }
  const { daysUntilSslExpiry, probe } = await domainsSvc.sslService.probeAndStore(
    { db, logger },
    row,
  );
  if (daysUntilSslExpiry !== null && daysUntilSslExpiry <= domainsSvc.SSL_ALERT_THRESHOLD_DAYS) {
    try {
      const alertQueue = getQueue('alert-fire', config);
      await alertQueue.add(
        'ssl-expiry',
        {
          ruleMetric: 'ssl_expiry',
          siteId: row.siteId,
          domainId: row.id,
          domain: row.domain,
          value: daysUntilSslExpiry,
          message: `SSL for ${row.domain} expires in ${daysUntilSslExpiry}d`,
        },
        { jobId: `ssl-alert:${row.id}` },
      );
    } catch (err) {
      logger.warn(
        { err: { message: err instanceof Error ? err.message : String(err) } },
        'failed to enqueue ssl-expiry alert',
      );
    }
  }
  return { ok: probe.ok, sslDays: daysUntilSslExpiry };
}

export function startSslWorker(config: WorkerConnectionConfig): Worker<SslJobData> {
  const logger = getWorkerLogger();
  const worker = new Worker<SslJobData>(
    QUEUE_NAME,
    async (job: Job<SslJobData>) => {
      if (job.data.kind === 'sweep') return processSweep(config);
      if (job.data.kind === 'probe-one') return processProbeOne(job.data, config);
      throw new Error(`unknown ssl job: ${(job.data as { kind: string }).kind}`);
    },
    {
      connection: getQueueConnection(config) as unknown as ConnectionOptions,
      concurrency: 5,
    },
  );
  worker.on('failed', (job, err) => {
    logger.warn(
      {
        event: 'ssl.job_failed',
        jobId: job?.id,
        err: { message: err.message },
      },
      'ssl job failed',
    );
  });
  return worker;
}
