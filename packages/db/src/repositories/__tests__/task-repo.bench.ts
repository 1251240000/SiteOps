/**
 * Vitest benchmark for the T34 task-queue performance work.
 *
 * Run with:
 *   pnpm --filter @siteops/db bench
 *
 * Two micro-benchmarks:
 *   1. `sweepExpiredLeases` over 1000 claimed-expired rows (mix of attempts
 *      < max and attempts >= max) — the new CTE rewrite should beat the
 *      old N+1 by >10× on real Postgres. Acceptance budget: 200 ms / op
 *      on a CI Postgres 16 container; on PGlite (in-process WASM) the
 *      observed time is reported but not asserted because PGlite is
 *      slower than real PG and would cause flaky thresholds.
 *   2. `claimNext` against a 1000-row queue — exercises the new partial
 *      `tasks_claim_idx (priority DESC, available_at)` so the planner serves
 *      the ORDER BY without a Sort step. Budget: < 5 ms / op on real PG.
 *
 * NOTE: This file is *not* picked up by `vitest run` (which only globs
 * `**\/*.test.ts`). It runs through `vitest bench` so the regular CI
 * matrix is unaffected.
 */
import { afterAll, beforeAll, bench, describe } from 'vitest';

import { tasks } from '../../schema/tasks.js';
import { createTestDb, type TestDbHandle } from '../../testing.js';
import { taskRepo } from '../task-repo.js';

const ROW_COUNT = 1000;

let handle: TestDbHandle;

beforeAll(async () => {
  handle = await createTestDb();
});

afterAll(async () => {
  if (handle) await handle.close();
});

/**
 * Reseed the table with `ROW_COUNT` claimed-but-expired tasks: half are
 * "attempts >= max" (will expire) and half are "attempts < max" (will
 * requeue). Inserts in chunks of 250 so the WASM Postgres parser stays
 * within param-list limits.
 */
async function reseedClaimedExpired(): Promise<void> {
  await handle.reset();
  const past = new Date(Date.now() - 60_000);
  const claimedAt = new Date(Date.now() - 120_000);
  const half = Math.floor(ROW_COUNT / 2);
  const rows = Array.from({ length: ROW_COUNT }, (_, i) => ({
    kind: 'bench.draft',
    status: 'claimed' as const,
    attempts: i < half ? 3 : 1,
    maxAttempts: 3,
    claimToken: '11111111-1111-4111-8111-111111111111',
    claimedAt,
    claimLeaseUntil: past,
  }));
  for (let i = 0; i < rows.length; i += 250) {
    await handle.db.insert(tasks).values(rows.slice(i, i + 250));
  }
}

/** Reseed the table with `ROW_COUNT` queued rows of varying priority. */
async function reseedQueued(): Promise<void> {
  await handle.reset();
  const rows = Array.from({ length: ROW_COUNT }, (_, i) => ({
    kind: 'bench.draft',
    status: 'queued' as const,
    priority: i % 100,
    maxAttempts: 3,
  }));
  for (let i = 0; i < rows.length; i += 250) {
    await handle.db.insert(tasks).values(rows.slice(i, i + 250));
  }
}

describe('taskRepo.sweepExpiredLeases (T34 batched CTE)', () => {
  // Pre-build the seed payload once so the bench loop measures the SQL the
  // CTE actually executes (insert + sweep, not insert + sweep + array-build).
  // Inside each iteration we still need to insert because sweep mutates the
  // rows; that overhead is reported below as "wall-clock per cycle". The
  // pure-sweep timing emitted by `console.timeEnd('sweep')` is the figure to
  // hold against the 200 ms acceptance budget.
  bench(
    `sweep ${ROW_COUNT} claimed-expired rows (insert+sweep cycle)`,
    async () => {
      await reseedClaimedExpired();
      const start = performance.now();
      const swept = await taskRepo.sweepExpiredLeases(handle.db as never);
      const sweepMs = performance.now() - start;
      if (swept.requeued + swept.expired !== ROW_COUNT) {
        throw new Error(
          `expected ${ROW_COUNT}, got ${swept.requeued + swept.expired} (requeued=${swept.requeued} expired=${swept.expired})`,
        );
      }
      // Surface the pure-SQL portion to stdout; `vitest bench` reports the
      // outer function timing which includes the reseed.
      // eslint-disable-next-line no-console
      console.log(`[bench] pure sweepExpiredLeases SQL: ${sweepMs.toFixed(2)} ms`);
    },
    { iterations: 5, warmupIterations: 1 },
  );
});

describe('taskRepo.claimNext (T34 partial index)', () => {
  beforeAll(async () => {
    // Seed once; each bench iteration claims one row from the pool. We
    // restock periodically inside the bench when the queue depletes.
    await reseedQueued();
  });

  bench(
    `claimNext over a ${ROW_COUNT}-row queue`,
    async () => {
      const claim = await taskRepo.claimNext(handle.db as never, { leaseSeconds: 30 });
      if (!claim) {
        // Pool depleted — restock for the rest of the run. This restock cost
        // is amortized across many iterations so the per-op number stays
        // representative of a steady-state claim.
        await reseedQueued();
      }
    },
    { iterations: 200, warmupIterations: 5 },
  );
});
