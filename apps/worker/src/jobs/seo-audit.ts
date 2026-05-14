/**
 * `seo-audit` job processor.
 *
 * Two job names share this queue:
 *   - `seo-sweep`: daily fanout — enqueues one `audit` job per active site
 *   - `audit`: per-site audit, payload `{ siteId }`
 */
import { Worker, type ConnectionOptions, type Job } from 'bullmq';

import { siteRepo } from '@siteops/db';
import { audits as auditsSvc } from '@siteops/services';

import { getWorkerDb } from '../db.js';
import { getWorkerEnv } from '../env.js';
import { getWorkerLogger } from '../logger.js';
import { getQueue, getQueueConnection } from '../queues.js';
import type { WorkerConnectionConfig } from '../queues.js';

export type SeoAuditJobData = { siteId: string };

async function processSeoSweep(config: WorkerConnectionConfig): Promise<{ enqueued: number }> {
  const db = getWorkerDb();
  const queue = getQueue('seo-audit', config);
  const sites = await siteRepo.listActive(db);
  for (const s of sites) {
    await queue.add(
      'audit',
      { siteId: s.id },
      { jobId: `seo:${s.id}:${new Date().toISOString().slice(0, 10)}` },
    );
  }
  return { enqueued: sites.length };
}

async function processSeoAuditSingle(
  job: Job<SeoAuditJobData>,
): Promise<{ auditRunId: string; score: number; findings: number }> {
  const logger = getWorkerLogger();
  const env = getWorkerEnv();
  const db = getWorkerDb();
  const { siteId } = job.data;
  if (!siteId) throw new Error('seo-audit: missing siteId');
  const site = await siteRepo.getById(db, siteId);
  if (!site) throw new Error(`seo-audit: site ${siteId} not found`);
  const result = await auditsSvc.auditService.runSeoAudit(
    { db, logger, dataDir: env.AUDIT_DATA_DIR },
    { siteId, siteUrl: site.primaryUrl },
  );
  return {
    auditRunId: result.run.id,
    score: result.summary.score,
    findings: result.summary.total,
  };
}

export function startSeoAuditWorker(
  config: WorkerConnectionConfig,
): Worker<SeoAuditJobData | Record<string, never>> {
  const logger = getWorkerLogger();
  const worker = new Worker<SeoAuditJobData | Record<string, never>>(
    'seo-audit',
    async (job) => {
      if (job.name === 'seo-sweep') return processSeoSweep(config);
      return processSeoAuditSingle(job as Job<SeoAuditJobData>);
    },
    {
      connection: getQueueConnection(config) as unknown as ConnectionOptions,
      concurrency: 3,
    },
  );
  worker.on('failed', (job, err) => {
    logger.warn(
      {
        event: 'seo.job_failed',
        jobId: job?.id,
        jobName: job?.name,
        err: { message: err.message },
      },
      'seo-audit job failed',
    );
  });
  return worker;
}
