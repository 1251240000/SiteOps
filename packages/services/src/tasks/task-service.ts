/**
 * Task queue service.
 *
 * Implements the contract documented in `tasks/T25-task-queue-api.md`:
 *
 *   - `enqueue`     idempotent insert (via `dedupe_key` partial unique index +
 *                   23505 race rescue)
 *   - `claimNext`   pull-mode claim, stamps a fresh `claim_token` + lease
 *   - `heartbeat`   extend a claim's lease
 *   - `complete`    settle a claim with `status='succeeded'`
 *   - `fail`        either bounce back to `queued` (with backoff) or terminate
 *                   as `failed`, depending on retry policy + attempts left
 *   - `cancel`      admin-only; only legal from `queued` or `claimed`
 *   - `reschedule`  admin-only; only legal from `queued`
 *   - `sweepExpired` housekeeping; called from the worker every minute or so
 *
 * All errors surface as `AppError` so the route layer can pass them straight
 * to the canonical error envelope.
 */
import {
  taskRepo,
  type Db,
  type NewTask,
  type Task,
  type TaskListOptions,
  type TaskListPage,
} from '@siteops/db';
import {
  AppError,
  computeTaskBackoffMs,
  type ClaimTaskInput,
  type CompleteTaskInput,
  type CreateTaskInput,
  type FailTaskInput,
  type HeartbeatTaskInput,
  type PatchTaskInput,
} from '@siteops/shared';

export type { Task, TaskListPage };

export type TaskServiceDeps = {
  db: Db;
  logger?: {
    info: (obj: Record<string, unknown>, msg?: string) => void;
    warn: (obj: Record<string, unknown>, msg?: string) => void;
  };
};

export type EnqueueResult = {
  task: Task;
  /** `true` when a brand-new row was inserted; `false` when deduped. */
  created: boolean;
};

export type ClaimResult = { idle: true; task?: undefined } | { idle: false; task: Task };

function inputToInsert(input: CreateTaskInput): NewTask {
  const out: NewTask = {
    kind: input.kind,
    payload: input.payload ?? {},
    priority: input.priority ?? 0,
    maxAttempts: input.maxAttempts ?? 3,
  };
  if (input.siteId !== undefined) out.siteId = input.siteId;
  if (input.dedupeKey !== undefined) out.dedupeKey = input.dedupeKey;
  if (input.availableAt !== undefined) out.availableAt = new Date(input.availableAt);
  return out;
}

/**
 * `true` if the underlying driver error represents a unique-constraint
 * violation. postgres-js / pg surface `code='23505'` directly; PGlite wraps
 * the error and only the message contains the constraint name.
 */
function isUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: unknown; message?: unknown };
  if (e.code === '23505') return true;
  if (typeof e.message === 'string' && /tasks_dedupe_active_uk/i.test(e.message)) return true;
  return false;
}

export const taskService = {
  async list(deps: TaskServiceDeps, opts: TaskListOptions): Promise<TaskListPage> {
    return taskRepo.list(deps.db, opts);
  },

  async getById(deps: TaskServiceDeps, id: string): Promise<Task> {
    const row = await taskRepo.getById(deps.db, id);
    if (!row) {
      throw new AppError('Task not found', { code: 'not_found', status: 404, details: { id } });
    }
    return row;
  },

  /**
   * Insert (or surface the existing duplicate when `dedupeKey` collides).
   *
   * Three paths:
   *   1. No `dedupeKey` → straight insert.
   *   2. `dedupeKey` matches an in-flight row → return that row, `created=false`.
   *   3. `dedupeKey` clears the read-side check but loses the write race →
   *      catch 23505, re-read, and surface the winner.
   */
  async enqueue(deps: TaskServiceDeps, input: CreateTaskInput): Promise<EnqueueResult> {
    if (input.dedupeKey) {
      const existing = await taskRepo.findActiveByDedupeKey(deps.db, input.dedupeKey);
      if (existing) {
        deps.logger?.info(
          {
            event: 'task.enqueue.deduped',
            taskId: existing.id,
            kind: existing.kind,
            dedupeKey: input.dedupeKey,
          },
          'task enqueue deduped',
        );
        return { task: existing, created: false };
      }
    }

    try {
      const created = await taskRepo.create(deps.db, inputToInsert(input));
      deps.logger?.info(
        {
          event: 'task.enqueue.created',
          taskId: created.id,
          kind: created.kind,
          priority: created.priority,
          dedupeKey: created.dedupeKey,
        },
        'task enqueued',
      );
      return { task: created, created: true };
    } catch (err) {
      if (input.dedupeKey && isUniqueViolation(err)) {
        // Lost the race against a concurrent enqueue; re-read and surface
        // the winner so the caller still gets idempotent semantics.
        const winner = await taskRepo.findActiveByDedupeKey(deps.db, input.dedupeKey);
        if (winner) {
          deps.logger?.info(
            {
              event: 'task.enqueue.dedupe_race',
              taskId: winner.id,
              dedupeKey: input.dedupeKey,
            },
            'task enqueue lost dedupe race; surfacing winner',
          );
          return { task: winner, created: false };
        }
      }
      throw err;
    }
  },

  async claimNext(
    deps: TaskServiceDeps,
    input: ClaimTaskInput,
    claimedBy?: string | null,
  ): Promise<ClaimResult> {
    const claim = await taskRepo.claimNext(deps.db, {
      kinds: input.kinds,
      leaseSeconds: input.leaseSeconds,
      claimedBy: claimedBy ?? null,
    });
    if (!claim) return { idle: true };
    deps.logger?.info(
      {
        event: 'task.claimed',
        taskId: claim.id,
        kind: claim.kind,
        attempts: claim.attempts,
        claimedBy: claim.claimedBy,
        leaseUntil: claim.claimLeaseUntil,
      },
      'task claimed',
    );
    return { idle: false, task: claim };
  },

  async heartbeat(deps: TaskServiceDeps, id: string, input: HeartbeatTaskInput): Promise<Task> {
    const updated = await taskRepo.extendLease(deps.db, id, input.claimToken, input.leaseSeconds);
    if (!updated) {
      throw new AppError('Claim token mismatch or task not in claimed state', {
        code: 'claim_token_mismatch',
        status: 409,
        details: { id },
      });
    }
    return updated;
  },

  async complete(deps: TaskServiceDeps, id: string, input: CompleteTaskInput): Promise<Task> {
    const done = await taskRepo.complete(deps.db, id, input.claimToken, input.result);
    if (!done) {
      throw new AppError('Claim token mismatch or task not in claimed state', {
        code: 'claim_token_mismatch',
        status: 409,
        details: { id },
      });
    }
    deps.logger?.info(
      { event: 'task.completed', taskId: done.id, kind: done.kind },
      'task completed',
    );
    return done;
  },

  /**
   * Settle a claimed task with a failure. When `retry` is true and there are
   * attempts remaining, bounce back to `queued` with a backoff; otherwise
   * terminate as `failed`. Atomic on `(id, claimToken, status='claimed')`.
   */
  async fail(deps: TaskServiceDeps, id: string, input: FailTaskInput): Promise<Task> {
    const current = await taskRepo.getById(deps.db, id);
    if (!current) {
      throw new AppError('Task not found', { code: 'not_found', status: 404, details: { id } });
    }
    if (current.status !== 'claimed' || current.claimToken !== input.claimToken) {
      throw new AppError('Claim token mismatch or task not in claimed state', {
        code: 'claim_token_mismatch',
        status: 409,
        details: { id },
      });
    }

    const exhausted = current.attempts >= current.maxAttempts;
    const willRetry = input.retry !== false && !exhausted;

    if (!willRetry) {
      const terminal = await taskRepo.failTerminal(deps.db, id, input.claimToken, input.error);
      if (!terminal) {
        // Lost a race — re-read and surface a stable conflict error.
        throw new AppError('Claim token mismatch or task not in claimed state', {
          code: 'claim_token_mismatch',
          status: 409,
          details: { id },
        });
      }
      deps.logger?.warn(
        {
          event: 'task.failed_terminal',
          taskId: terminal.id,
          kind: terminal.kind,
          attempts: terminal.attempts,
          maxAttempts: terminal.maxAttempts,
          retryRequested: input.retry !== false,
          exhausted,
        },
        'task failed (terminal)',
      );
      return terminal;
    }

    const backoffMs = computeTaskBackoffMs(current.attempts);
    const nextAvailable = new Date(Date.now() + backoffMs);
    const requeued = await taskRepo.requeueAfterFailure(
      deps.db,
      id,
      input.claimToken,
      input.error,
      nextAvailable,
    );
    if (!requeued) {
      throw new AppError('Claim token mismatch or task not in claimed state', {
        code: 'claim_token_mismatch',
        status: 409,
        details: { id },
      });
    }
    deps.logger?.info(
      {
        event: 'task.requeued',
        taskId: requeued.id,
        kind: requeued.kind,
        attempts: requeued.attempts,
        nextAvailable: requeued.availableAt,
        backoffMs,
      },
      'task requeued after failure',
    );
    return requeued;
  },

  /**
   * Admin-only mutation. The PATCH route maps `status='cancelled'` →
   * cancel(), `availableAt` → reschedule(), `priority` → reprioritize().
   * Multiple fields in one call are applied left-to-right via a single SQL
   * UPDATE.
   */
  async patch(deps: TaskServiceDeps, id: string, input: PatchTaskInput): Promise<Task> {
    const current = await taskRepo.getById(deps.db, id);
    if (!current) {
      throw new AppError('Task not found', { code: 'not_found', status: 404, details: { id } });
    }

    const patch: Partial<NewTask> = {};

    if (input.status === 'cancelled') {
      if (current.status !== 'queued' && current.status !== 'claimed') {
        throw new AppError(`Cannot cancel a task in status '${current.status}'`, {
          code: 'conflict',
          status: 409,
          details: { id, status: current.status },
        });
      }
      patch.status = 'cancelled';
      patch.finishedAt = new Date();
      patch.claimToken = null;
      patch.claimLeaseUntil = null;
    }

    if (input.availableAt !== undefined) {
      // Rescheduling a non-queued row would silently miss the claim cycle.
      // Refuse so the caller knows.
      const finalStatus = patch.status ?? current.status;
      if (finalStatus !== 'queued') {
        throw new AppError(
          `Cannot reschedule a task in status '${finalStatus}' (only 'queued' is reschedulable)`,
          { code: 'conflict', status: 409, details: { id, status: finalStatus } },
        );
      }
      patch.availableAt = new Date(input.availableAt);
    }

    if (input.priority !== undefined) {
      patch.priority = input.priority;
    }

    const updated = await taskRepo.update(deps.db, id, patch);
    if (!updated) {
      throw new AppError('Task vanished mid-update', {
        code: 'not_found',
        status: 404,
        details: { id },
      });
    }
    deps.logger?.info(
      {
        event: 'task.patched',
        taskId: updated.id,
        from: current.status,
        to: updated.status,
        priority: updated.priority,
      },
      'task patched',
    );
    return updated;
  },

  /** Worker housekeeping wrapper. Returns counts for observability. */
  async sweepExpired(
    deps: TaskServiceDeps,
    now: Date = new Date(),
  ): Promise<{ requeued: number; expired: number }> {
    const out = await taskRepo.sweepExpiredLeases(deps.db, now);
    if (out.requeued > 0 || out.expired > 0) {
      deps.logger?.info({ event: 'task.sweep_expired', ...out }, 'task lease sweep complete');
    }
    return out;
  },
};
