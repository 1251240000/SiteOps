/**
 * Agent-runs service.
 *
 * The "audit ledger" for every API-key authenticated mutation. Two surfaces:
 *
 *   - `record(input)` — used by `withApiKeyAudited` in the web layer to
 *     transparently log every call without changing the original handler.
 *   - `list / getById / summary / pruneOlderThan` — back the dashboard
 *     (`apps/web/app/(dashboard)/agent-runs/`) and the daily housekeeping job.
 *
 * The wrapper `wrap()` is also exported so tests and ad-hoc tooling can opt
 * into the same record-on-success / record-on-throw behavior without going
 * through the HTTP envelope.
 */
import {
  agentRunRepo,
  type AgentRunListItem,
  type AgentRunListOptions,
  type AgentRunListPage,
  type AgentRunSummary,
  type Db,
  type NewAgentRun,
} from '@siteops/db';
import { AppError, AGENT_RUN_RETENTION_DAYS } from '@siteops/shared';

export type { AgentRunListItem, AgentRunListPage, AgentRunSummary };

export type AgentRunServiceDeps = {
  db: Db;
  logger?: {
    info: (obj: Record<string, unknown>, msg?: string) => void;
    warn: (obj: Record<string, unknown>, msg?: string) => void;
  };
};

export type RecordAgentRunInput = {
  apiKeyId: string;
  agentName: string;
  action: string;
  input?: Record<string, unknown> | null | undefined;
  output?: Record<string, unknown> | null | undefined;
  status: 'success' | 'failed';
  durationMs?: number | null;
};

export type WrapContext = {
  apiKeyId: string;
  agentName: string;
  action: string;
  input?: Record<string, unknown> | null | undefined;
};

/**
 * Helpers for the duration timer. `process.hrtime.bigint` is monotonic so we
 * use it instead of `Date.now()` (which can jitter under NTP corrections).
 */
function nowNs(): bigint {
  return process.hrtime.bigint();
}

function durationMs(startNs: bigint): number {
  return Number((nowNs() - startNs) / 1_000_000n);
}

function toRecord(v: unknown): Record<string, unknown> | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'object') return { value: v as unknown };
  if (Array.isArray(v)) return { items: v };
  return v as Record<string, unknown>;
}

export const agentRunService = {
  async record(deps: AgentRunServiceDeps, input: RecordAgentRunInput): Promise<void> {
    const row: NewAgentRun = {
      apiKeyId: input.apiKeyId,
      agentName: input.agentName,
      action: input.action,
      status: input.status,
      durationMs: input.durationMs ?? null,
      input: toRecord(input.input ?? null),
      output: toRecord(input.output ?? null),
    };
    await agentRunRepo.create(deps.db, row);
  },

  /**
   * Wrap a handler-shaped function so that:
   *   - on success → records `status='success'`, captures the resolved value
   *     into `output` (if it's an object)
   *   - on throw   → records `status='failed'` with `output = { error: ... }`
   *     and **re-throws** so the caller can still translate the error
   *
   * The recording itself is best-effort: a DB write failure is logged at
   * `warn` but never bubbles into the wrapped fn's return value or the throw
   * path. This lets HTTP handlers safely build on top of it.
   */
  async wrap<T>(deps: AgentRunServiceDeps, ctx: WrapContext, fn: () => Promise<T>): Promise<T> {
    const started = nowNs();
    try {
      const result = await fn();
      const ms = durationMs(started);
      await this.record(deps, {
        apiKeyId: ctx.apiKeyId,
        agentName: ctx.agentName,
        action: ctx.action,
        input: ctx.input ?? null,
        output: result === undefined ? null : (result as unknown as Record<string, unknown>),
        status: 'success',
        durationMs: ms,
      }).catch((err) => {
        deps.logger?.warn(
          {
            event: 'agent_run.record_failed',
            action: ctx.action,
            err: { message: err instanceof Error ? err.message : String(err) },
          },
          'agent-run record failed (success path)',
        );
      });
      return result;
    } catch (err) {
      const ms = durationMs(started);
      const message = err instanceof Error ? err.message : String(err);
      await this.record(deps, {
        apiKeyId: ctx.apiKeyId,
        agentName: ctx.agentName,
        action: ctx.action,
        input: ctx.input ?? null,
        output: { error: message },
        status: 'failed',
        durationMs: ms,
      }).catch((recErr) => {
        deps.logger?.warn(
          {
            event: 'agent_run.record_failed',
            action: ctx.action,
            err: {
              message: recErr instanceof Error ? recErr.message : String(recErr),
            },
          },
          'agent-run record failed (failed path)',
        );
      });
      throw err;
    }
  },

  async list(deps: AgentRunServiceDeps, opts: AgentRunListOptions): Promise<AgentRunListPage> {
    return agentRunRepo.list(deps.db, opts);
  },

  async getById(deps: AgentRunServiceDeps, id: string): Promise<AgentRunListItem> {
    const row = await agentRunRepo.getByIdWithKey(deps.db, id);
    if (!row) {
      throw new AppError('Agent run not found', {
        code: 'not_found',
        status: 404,
        details: { id },
      });
    }
    return row;
  },

  async summary(
    deps: AgentRunServiceDeps,
    range: { from?: Date; to?: Date } = {},
  ): Promise<AgentRunSummary> {
    return agentRunRepo.summary(deps.db, range);
  },

  /** Housekeeping wrapper. Default retention follows `AGENT_RUN_RETENTION_DAYS`. */
  async pruneOlderThan(
    deps: AgentRunServiceDeps,
    days: number = AGENT_RUN_RETENTION_DAYS,
  ): Promise<number> {
    const deleted = await agentRunRepo.pruneOlderThan(deps.db, days);
    if (deleted > 0) {
      deps.logger?.info({ event: 'agent_run.pruned', deleted, days }, 'agent-runs prune complete');
    }
    return deleted;
  },
};
