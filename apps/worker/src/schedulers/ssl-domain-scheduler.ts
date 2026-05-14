/**
 * SSL / domain expiry scheduler.
 *
 * Registers a daily repeatable `sweep` job that the `ssl-domain-expiry`
 * worker (see `jobs/ssl-domain-expiry.ts`) handles by fanning out one
 * `probe-one` per domain.
 *
 * Time of day: 03:17 UTC (a random-ish minute to avoid colliding with the
 * SEO/lighthouse 03:00/04:00 sweeps).
 */
import { getQueue } from '../queues.js';
import type { WorkerConnectionConfig } from '../queues.js';

export async function startSslScheduler(config: WorkerConnectionConfig): Promise<void> {
  const queue = getQueue('ssl-domain-expiry', config);
  await queue.add(
    'sweep',
    { kind: 'sweep' },
    {
      repeat: { pattern: '17 3 * * *' },
      jobId: 'ssl-sweep',
      removeOnComplete: true,
      removeOnFail: true,
    },
  );
}
