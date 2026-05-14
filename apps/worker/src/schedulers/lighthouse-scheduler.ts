/**
 * Lighthouse scheduler — daily 05:13 UTC sweep. The job is handled by the
 * `lighthouse-run` worker (jobs/lighthouse-run.ts).
 */
import { getQueue } from '../queues.js';
import type { WorkerConnectionConfig } from '../queues.js';

export async function startLighthouseScheduler(config: WorkerConnectionConfig): Promise<void> {
  const queue = getQueue('lighthouse-run', config);
  await queue.add(
    'lighthouse-sweep',
    {},
    {
      repeat: { pattern: '13 5 * * *' },
      jobId: 'lighthouse-sweep',
      removeOnComplete: true,
      removeOnFail: true,
    },
  );
}
