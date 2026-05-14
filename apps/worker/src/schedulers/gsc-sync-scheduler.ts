import { getQueue } from '../queues.js';
import type { WorkerConnectionConfig } from '../queues.js';

export async function startGscSyncScheduler(config: WorkerConnectionConfig): Promise<void> {
  const queue = getQueue('gsc-sync', config);
  await queue.add(
    'sweep',
    { kind: 'sweep' },
    {
      // Once daily at 04:23 UTC (after SEO/Lighthouse sweeps).
      repeat: { pattern: '23 4 * * *' },
      jobId: 'gsc-sync-sweep',
      removeOnComplete: true,
      removeOnFail: true,
    },
  );
}
