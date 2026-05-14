/**
 * Cloudflare sync scheduler. Registers an hourly repeatable `sweep` job on
 * the `cf-sync` queue. The worker (`processCfSweep`) short-circuits if
 * `CF_API_TOKEN` isn't configured.
 */
import { getQueue } from '../queues.js';
import type { WorkerConnectionConfig } from '../queues.js';

export async function startCfSyncScheduler(config: WorkerConnectionConfig): Promise<void> {
  const queue = getQueue('cf-sync', config);
  await queue.add(
    'sweep',
    { kind: 'sweep' },
    {
      // Top of every hour.
      repeat: { pattern: '0 * * * *' },
      jobId: 'cf-sync-sweep',
      removeOnComplete: true,
      removeOnFail: true,
    },
  );
}
