import { getQueue } from '../queues.js';
import type { WorkerConnectionConfig } from '../queues.js';

export async function startGhSyncScheduler(config: WorkerConnectionConfig): Promise<void> {
  const queue = getQueue('gh-sync', config);
  await queue.add(
    'sweep',
    { kind: 'sweep' },
    {
      // 7 minutes past every hour (offset from cf-sync to spread load).
      repeat: { pattern: '7 * * * *' },
      jobId: 'gh-sync-sweep',
      removeOnComplete: true,
      removeOnFail: true,
    },
  );
}
