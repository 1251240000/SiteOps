/**
 * `GET /api/v1/system/jobs` — admin diagnostic endpoint (T38).
 *
 * Reads job counts (`waiting / active / delayed / completed / failed`) for
 * every BullMQ queue declared in `lib/queues.ts:ALL_QUEUES` and returns
 * them as an array, one entry per queue. Lets operators eyeball queue
 * health from the dashboard or `curl` without dropping into `redis-cli`.
 *
 * Each per-queue lookup is independent — a single broken queue surfaces
 * with `error` set and zeros, the other queues still report.
 *
 * Auth: admin session only. Per-queue depths are operationally sensitive
 * (you can infer how saturated the platform is), so we keep it off the
 * Bearer surface.
 */
import { getAllQueueStatuses } from '@/lib/queues';
import { ok, withApi } from '@/lib/with-api';

export const dynamic = 'force-dynamic';

export const GET = withApi(async () => {
  const stats = await getAllQueueStatuses();
  return ok(stats);
});
