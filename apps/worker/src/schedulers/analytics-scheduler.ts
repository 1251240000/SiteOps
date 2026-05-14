import { getQueue } from '../queues.js';
import type { WorkerConnectionConfig } from '../queues.js';

export async function startAnalyticsScheduler(config: WorkerConnectionConfig): Promise<void> {
  const queue = getQueue('analytics-sync', config);
  await queue.add(
    'sweep',
    { kind: 'sweep' },
    {
      // 17 minutes past every hour.
      repeat: { pattern: '17 * * * *' },
      jobId: 'analytics-sync-sweep',
      removeOnComplete: true,
      removeOnFail: true,
    },
  );
}
