/**
 * Tasks repository.
 *
 * Backs the pull-mode task queue documented in `tasks/T25-task-queue-api.md`.
 * The interesting bits are:
 *
 *   - `claimNext`: a single CTE-style `UPDATE ... WHERE id IN (SELECT ... FOR
 *     UPDATE SKIP LOCKED LIMIT 1)` so two concurrent agents never grab the
 *     same row. The `FOR UPDATE SKIP LOCKED` lets the loser fall through to
 *     the next available row instead of blocking.
 *
 *   - `findActiveByDedupeKey`: looks up a task by `dedupe_key` while it's
 *     still in flight (queued|claimed). Terminal rows release the slot so the
 *     same key can re-enqueue once the previous instance settled.
 *
 *   - `requeueExpiredLeases` / `expireExhaustedLeases`: housekeeping jobs;
 *     past-due `claimed` rows either bounce back to `queued` (with backoff)
 *     or terminate as `expired` once `attempts >= max_attempts`.
 *
 * The state machine itself lives in the service layer; the repo only does
 * mechanical SQL.
 */
import { randomUUID } from 'node:crypto';

import { and, asc, desc, eq, ilike, inArray, or, sql, type SQL } from 'drizzle-orm';

import { TASK_BACKOFF_BASE_MS, TASK_BACKOFF_MAX_MS, computeTaskBackoffMs } from '@siteops/shared';

import type { Db } from '../client.js';
import { tasks, type NewTask, type Task, type TaskStatus } from '../schema/tasks.js';

export type TaskListFilters = {
  q?: string | undefined;
  kind?: string | string[] | undefined;
  siteId?: string | undefined;
  status?: TaskStatus | TaskStatus[] | undefined;
};

export type TaskListSort =
  | 'created_at'
  | '-created_at'
  | 'available_at'
  | '-available_at'
  | 'priority'
  | '-priority';

export type TaskListOptions = {
  filters?: TaskListFilters;
  sort?: TaskListSort;
  page?: number;
  limit?: number;
};

export type TaskListPage = {
  items: Task[];
  page: number;
  limit: number;
  total: number;
};

export type ClaimNextOptions = {
  kinds?: readonly string[] | undefined;
  /** Owning principal (e.g. api_key.id). Stored on `claimed_by` for audit. */
  claimedBy?: string | null | undefined;
  leaseSeconds: number;
  /** Override "now" for deterministic tests. Defaults to `new Date()`. */
  now?: Date;
};

function toArray<T>(v: T | T[] | undefined): T[] | undefined {
  if (v === undefined) return undefined;
  return Array.isArray(v) ? v : [v];
}

function buildWhere(filters: TaskListFilters | undefined): SQL | undefined {
  const f = filters ?? {};
  const clauses: SQL[] = [];

  if (f.q && f.q.trim().length > 0) {
    const pattern = `%${f.q.trim()}%`;
    const orClause = or(ilike(tasks.kind, pattern), ilike(tasks.lastError, pattern));
    if (orClause) clauses.push(orClause);
  }

  const kinds = toArray(f.kind);
  if (kinds && kinds.length > 0) {
    clauses.push(inArray(tasks.kind, kinds));
  }

  if (f.siteId) {
    clauses.push(eq(tasks.siteId, f.siteId));
  }

  const statuses = toArray(f.status);
  if (statuses && statuses.length > 0) {
    clauses.push(inArray(tasks.status, statuses));
  }

  if (clauses.length === 0) return undefined;
  return clauses.length === 1 ? clauses[0] : and(...clauses);
}

function sortClause(sort: TaskListSort | undefined): SQL {
  switch (sort) {
    case 'created_at':
      return asc(tasks.createdAt);
    case 'available_at':
      return asc(tasks.availableAt);
    case '-available_at':
      return desc(tasks.availableAt);
    case 'priority':
      return asc(tasks.priority);
    case '-priority':
      return desc(tasks.priority);
    case '-created_at':
    case undefined:
    default:
      return desc(tasks.createdAt);
  }
}

export const taskRepo = {
  async list(db: Db, opts: TaskListOptions = {}): Promise<TaskListPage> {
    const page = Math.max(1, opts.page ?? 1);
    const limit = Math.min(100, Math.max(1, opts.limit ?? 20));
    const offset = (page - 1) * limit;
    const where = buildWhere(opts.filters);
    const order = sortClause(opts.sort);

    const items = await db
      .select()
      .from(tasks)
      .where(where)
      .orderBy(order)
      .limit(limit)
      .offset(offset);

    const totalRow = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(tasks)
      .where(where);

    return { items, page, limit, total: totalRow[0]?.count ?? 0 };
  },

  async getById(db: Db, id: string): Promise<Task | null> {
    const rows = await db.select().from(tasks).where(eq(tasks.id, id)).limit(1);
    return rows[0] ?? null;
  },

  /**
   * Look up an in-flight (queued or claimed) row by its idempotency key. The
   * partial unique index `tasks_dedupe_active_uk` guarantees at most one match.
   */
  async findActiveByDedupeKey(db: Db, dedupeKey: string): Promise<Task | null> {
    if (!dedupeKey) return null;
    const rows = await db
      .select()
      .from(tasks)
      .where(and(eq(tasks.dedupeKey, dedupeKey), inArray(tasks.status, ['queued', 'claimed'])))
      .limit(1);
    return rows[0] ?? null;
  },

  async create(db: Db, input: NewTask): Promise<Task> {
    const rows = await db.insert(tasks).values(input).returning();
    const row = rows[0];
    if (!row) throw new Error('taskRepo.create: insert returned no row');
    return row;
  },

  async update(db: Db, id: string, patch: Partial<NewTask>): Promise<Task | null> {
    const rows = await db.update(tasks).set(patch).where(eq(tasks.id, id)).returning();
    return rows[0] ?? null;
  },

  /**
   * Atomically claim the highest-priority eligible task and stamp it with a
   * fresh `claim_token` + `claim_lease_until = now() + leaseSeconds`. Returns
   * the claimed row (so the caller can read `claim_token`) or `null` when the
   * queue is empty / nothing matches the filter.
   *
   * Concurrency: a row-level lock is taken via `SELECT ... FOR UPDATE SKIP
   * LOCKED` inside a transaction, then a Drizzle-typed `UPDATE ... RETURNING`
   * stamps the claim. The lock + UPDATE share the same tx so the row stays
   * locked between the two statements; concurrent callers fall through to the
   * next available row.
   *
   * Why two statements instead of a single CTE? `db.execute(sql\`...\`)` returns
   * raw snake_case driver rows; routing the UPDATE through Drizzle's typed
   * builder ensures camelCase column mapping for the returned `Task`.
   */
  async claimNext(db: Db, opts: ClaimNextOptions): Promise<Task | null> {
    const now = opts.now ?? new Date();
    const leaseUntil = new Date(now.getTime() + opts.leaseSeconds * 1000);
    const claimToken = randomUUID();
    const claimedBy = opts.claimedBy ?? null;
    const kinds = opts.kinds && opts.kinds.length > 0 ? Array.from(opts.kinds) : null;

    return db.transaction(async (tx) => {
      // Lock-and-skip: get the id of the next claimable row. Building the
      // kinds filter via `sql.join` rather than `${array}` ensures each kind
      // is bound as its own `text` param (matching the column type).
      const kindsClause = kinds
        ? sql`AND ${tasks.kind} IN (${sql.join(
            kinds.map((k) => sql`${k}`),
            sql`, `,
          )})`
        : sql``;
      const locked = await tx.execute<{ id: string }>(sql`
        SELECT ${tasks.id} AS id
        FROM ${tasks}
        WHERE ${tasks.status} = 'queued'
          AND ${tasks.availableAt} <= ${now}
          ${kindsClause}
        ORDER BY ${tasks.priority} DESC, ${tasks.availableAt} ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      `);
      const lockedRows =
        (locked as unknown as { rows: { id: string }[] }).rows ??
        (locked as unknown as { id: string }[]);
      const lockedId = Array.isArray(lockedRows) ? lockedRows[0]?.id : undefined;
      if (!lockedId) return null;

      const updated = await tx
        .update(tasks)
        .set({
          status: 'claimed',
          claimToken,
          claimedBy,
          claimedAt: now,
          claimLeaseUntil: leaseUntil,
          attempts: sql`${tasks.attempts} + 1`,
        })
        .where(eq(tasks.id, lockedId))
        .returning();
      return updated[0] ?? null;
    });
  },

  /**
   * Extend the lease on a claimed task. Used by agent heartbeats. Returns the
   * updated row when `claimToken` matches, `null` when the row was already
   * settled / expired / re-claimed by someone else.
   */
  async extendLease(
    db: Db,
    id: string,
    claimToken: string,
    leaseSeconds: number,
    now: Date = new Date(),
  ): Promise<Task | null> {
    const leaseUntil = new Date(now.getTime() + leaseSeconds * 1000);
    const rows = await db
      .update(tasks)
      .set({ claimLeaseUntil: leaseUntil })
      .where(and(eq(tasks.id, id), eq(tasks.claimToken, claimToken), eq(tasks.status, 'claimed')))
      .returning();
    return rows[0] ?? null;
  },

  /**
   * Mark a claimed task as `succeeded`. Atomic on `(id, claimToken, status)`;
   * returns `null` when the claim is stale.
   */
  async complete(
    db: Db,
    id: string,
    claimToken: string,
    result: Record<string, unknown> | undefined,
    now: Date = new Date(),
  ): Promise<Task | null> {
    const rows = await db
      .update(tasks)
      .set({
        status: 'succeeded',
        result: result ?? null,
        finishedAt: now,
        claimToken: null,
        claimLeaseUntil: null,
      })
      .where(and(eq(tasks.id, id), eq(tasks.claimToken, claimToken), eq(tasks.status, 'claimed')))
      .returning();
    return rows[0] ?? null;
  },

  /**
   * Mark a claimed task as `failed` (terminal). Atomic on `(id, claimToken, status)`.
   * Use `requeueAfterFailure` when the caller wants to retry instead.
   */
  async failTerminal(
    db: Db,
    id: string,
    claimToken: string,
    errorMessage: string,
    now: Date = new Date(),
  ): Promise<Task | null> {
    const rows = await db
      .update(tasks)
      .set({
        status: 'failed',
        lastError: errorMessage,
        finishedAt: now,
        claimToken: null,
        claimLeaseUntil: null,
      })
      .where(and(eq(tasks.id, id), eq(tasks.claimToken, claimToken), eq(tasks.status, 'claimed')))
      .returning();
    return rows[0] ?? null;
  },

  /**
   * Bounce a claimed task back to `queued` with a delayed `available_at`
   * (caller computes the backoff via `computeTaskBackoffMs`). Atomic on
   * `(id, claimToken, status)`.
   */
  async requeueAfterFailure(
    db: Db,
    id: string,
    claimToken: string,
    errorMessage: string,
    nextAvailableAt: Date,
  ): Promise<Task | null> {
    const rows = await db
      .update(tasks)
      .set({
        status: 'queued',
        lastError: errorMessage,
        availableAt: nextAvailableAt,
        claimToken: null,
        claimLeaseUntil: null,
      })
      .where(and(eq(tasks.id, id), eq(tasks.claimToken, claimToken), eq(tasks.status, 'claimed')))
      .returning();
    return rows[0] ?? null;
  },

  /**
   * Housekeeping pass over claimed-but-overdue rows.
   *
   * Rows whose `claim_lease_until <= now` either:
   *   - bounce back to `queued` with `available_at = now + backoff(attempts)`
   *     when `attempts < max_attempts`, or
   *   - terminate as `expired` (finished_at = now, last_error = "lease expired")
   *     when `attempts >= max_attempts`.
   *
   * Returns the count of rows modified in each branch.
   *
   * T34 rewrite: a single CTE with two batched UPDATE...RETURNING legs, one
   * per branch, in one round-trip. The previous implementation did one
   * SELECT + N UPDATEs (N+1) and started melting once the worker fell behind
   * and a few thousand leases expired in a burst. The CTE version walks the
   * partial `tasks_lease_idx` (status='claimed') exactly once and stamps every
   * matching row in batch.
   *
   * The backoff curve mirrors `computeTaskBackoffMs` from `@siteops/shared`:
   *   `LEAST(TASK_BACKOFF_MAX_MS, TASK_BACKOFF_BASE_MS * 2^(max(attempts,1)-1))`
   * — using `GREATEST(attempts, 1)` so freshly-incremented `attempts=0` rows
   * (which `claimNext` should never produce, but tests can seed) stay safe.
   */
  async sweepExpiredLeases(
    db: Db,
    now: Date = new Date(),
  ): Promise<{ requeued: number; expired: number }> {
    const baseSec = Math.round(TASK_BACKOFF_BASE_MS / 1000);
    const maxSec = Math.round(TASK_BACKOFF_MAX_MS / 1000);
    const result = await db.execute<{ expired_count: number; requeued_count: number }>(sql`
      WITH expired AS (
        UPDATE ${tasks}
           SET status = 'expired',
               last_error = 'lease expired',
               finished_at = ${now},
               claim_token = NULL,
               claim_lease_until = NULL
         WHERE status = 'claimed'
           AND claim_lease_until IS NOT NULL
           AND claim_lease_until <= ${now}
           AND attempts >= max_attempts
        RETURNING id
      ), requeued AS (
        UPDATE ${tasks}
           SET status = 'queued',
               available_at = ${now}::timestamptz + LEAST(
                 make_interval(secs => ${maxSec}),
                 make_interval(secs => ${baseSec}) * pow(2, GREATEST(attempts, 1) - 1)
               ),
               claim_token = NULL,
               claim_lease_until = NULL
         WHERE status = 'claimed'
           AND claim_lease_until IS NOT NULL
           AND claim_lease_until <= ${now}
           AND attempts < max_attempts
        RETURNING id
      )
      SELECT
        (SELECT count(*)::int FROM expired)  AS expired_count,
        (SELECT count(*)::int FROM requeued) AS requeued_count
    `);
    const rows =
      (result as unknown as { rows: { expired_count: number; requeued_count: number }[] }).rows ??
      (result as unknown as { expired_count: number; requeued_count: number }[]);
    const row = Array.isArray(rows) ? rows[0] : undefined;
    return {
      expired: row?.expired_count ?? 0,
      requeued: row?.requeued_count ?? 0,
    };
  },
};

/** Re-exported so callers (services / workers) can verify backoff parity with
 *  the SQL formula above. The repo intentionally does not call this anymore;
 *  the sweep does the math in SQL to stay one round-trip. */
export { computeTaskBackoffMs };
