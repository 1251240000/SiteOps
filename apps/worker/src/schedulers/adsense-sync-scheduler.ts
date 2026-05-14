import { getQueue } from '../queues.js';
import type { WorkerConnectionConfig } from '../queues.js';

export async function startAdsenseSyncScheduler(config: WorkerConnectionConfig): Promise<void> {
  const queue = getQueue('adsense-sync', config);
  await queue.add(
    'sweep',
    { kind: 'sweep' },
    {
      // Once daily at 05:43 UTC.
      repeat: { pattern: '43 5 * * *' },
      jobId: 'adsense-sync-sweep',
      removeOnComplete: true,
      removeOnFail: true,
    },
  );
}
