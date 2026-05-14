/** Housekeeping scheduler — daily 02:33 UTC. */
import { getQueue } from '../queues.js';
import type { WorkerConnectionConfig } from '../queues.js';

export async function startHousekeepingScheduler(config: WorkerConnectionConfig): Promise<void> {
  const queue = getQueue('housekeeping', config);
  await queue.add(
    'sweep',
    {},
    {
      repeat: { pattern: '33 2 * * *' },
      jobId: 'housekeeping-sweep',
      removeOnComplete: true,
      removeOnFail: true,
    },
  );
}
