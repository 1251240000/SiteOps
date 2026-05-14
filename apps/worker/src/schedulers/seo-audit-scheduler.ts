/**
 * SEO audit scheduler — registers a daily repeatable. The `seo-audit`
 * worker (jobs/seo-audit.ts) handles both the `seo-sweep` fanout and the
 * per-site `audit` jobs it produces.
 */
import { getQueue } from '../queues.js';
import type { WorkerConnectionConfig } from '../queues.js';

export async function startSeoAuditScheduler(config: WorkerConnectionConfig): Promise<void> {
  const queue = getQueue('seo-audit', config);
  await queue.add(
    'seo-sweep',
    {},
    {
      repeat: { pattern: '3 4 * * *' },
      jobId: 'seo-sweep',
      removeOnComplete: true,
      removeOnFail: true,
    },
  );
}
