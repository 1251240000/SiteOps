/**
 * Agent-runs repository.
 *
 * The append-only audit log for every Bearer-key-authenticated mutation that
 * goes through `withApiKeyAudited`. The shape lives in `0000_init.sql`;
 * this repo provides:
 *
 *   - `create` — single-row insert, used by the audit wrapper
 *   - `list`   — filtered + paginated reads for the dashboard
 *   - `getByIdWithKey` — single-row read joined with `api_keys.name`
 *   - `summary` — aggregated counts + p50/p95 over a time window
 *   - `pruneOlderThan` — daily housekeeping
 *
 * Sorting and filter semantics mirror `listAgentRunsQuerySchema` in
 * `@siteops/shared`.
 */
import { and, asc, count, desc, eq, gte, ilike, lte, sql, type SQL } from 'drizzle-orm';

import type { Db } from '../client.js';
import {
  agentRuns,
  type AgentRun,
  type AgentRunStatus,
  type NewAgentRun,
} from '../schema/agent-runs.js';
import { apiKeys } from '../schema/api-keys.js';

export type AgentRunListFilters = {
  apiKeyId?: string | undefined;
  agentName?: string | undefined;
  /** `noun.verb` exact match, or `noun.*` prefix LIKE. Empty/undefined → unrestricted. */
  action?: string | undefined;
  status?: AgentRunStatus | undefined;
  from?: Date | undefined;
  to?: Date | undefined;
};

export type AgentRunListOptions = {
  filters?: AgentRunListFilters;
  sort?: '-created_at' | 'created_at';
  page?: number;
  limit?: number;
};

export type AgentRunListItem = AgentRun & {
  apiKey: { id: string; name: string } | null;
};

export type AgentRunListPage = {
  items: AgentRunListItem[];
  page: number;
  limit: number;
  total: number;
};

export type AgentRunSummary = {
  total: number;
  succeeded: number;
  failed: number;
  /** Median duration in ms. `null` when the window has no rows. */
  p50DurationMs: number | null;
  /** 95th percentile duration in ms. `null` when the window has no rows. */
  p95DurationMs: number | null;
  /** Distinct `api_key_id` values observed in the window. */
  activeKeys: number;
};

function buildWhere(filters: AgentRunListFilters | undefined): SQL | undefined {
  const f = filters ?? {};
  const clauses: SQL[] = [];

  if (f.apiKeyId) clauses.push(eq(agentRuns.apiKeyId, f.apiKeyId));
  if (f.agentName) clauses.push(eq(agentRuns.agentName, f.agentName));
  if (f.action) {
    // `tasks.*` → ILIKE 'tasks.%'; everything else is an exact match.
    if (f.action.endsWith('.*')) {
      clauses.push(ilike(agentRuns.action, `${f.action.slice(0, -2)}.%`));
    } else {
      clauses.push(eq(agentRuns.action, f.action));
    }
  }
  if (f.status) clauses.push(eq(agentRuns.status, f.status));
  if (f.from) clauses.push(gte(agentRuns.createdAt, f.from));
  if (f.to) clauses.push(lte(agentRuns.createdAt, f.to));

  if (clauses.length === 0) return undefined;
  return clauses.length === 1 ? clauses[0] : and(...clauses);
}

export const agentRunRepo = {
  async create(db: Db, input: NewAgentRun): Promise<AgentRun> {
    const rows = await db.insert(agentRuns).values(input).returning();
    const row = rows[0];
    if (!row) throw new Error('agentRunRepo.create: insert returned no row');
    return row;
  },

  async list(db: Db, opts: AgentRunListOptions = {}): Promise<AgentRunListPage> {
    const page = Math.max(1, opts.page ?? 1);
    const limit = Math.min(100, Math.max(1, opts.limit ?? 50));
    const offset = (page - 1) * limit;
    const where = buildWhere(opts.filters);
    const orderBy =
      opts.sort === 'created_at' ? asc(agentRuns.createdAt) : desc(agentRuns.createdAt);

    const rows = await db
      .select({
        run: agentRuns,
        apiKeyId: apiKeys.id,
        apiKeyName: apiKeys.name,
      })
      .from(agentRuns)
      .leftJoin(apiKeys, eq(apiKeys.id, agentRuns.apiKeyId))
      .where(where)
      .orderBy(orderBy)
      .limit(limit)
      .offset(offset);

    const items: AgentRunListItem[] = rows.map((r) => ({
      ...r.run,
      apiKey: r.apiKeyId && r.apiKeyName ? { id: r.apiKeyId, name: r.apiKeyName } : null,
    }));

    const totalRow = await db.select({ c: count() }).from(agentRuns).where(where);

    return { items, page, limit, total: totalRow[0]?.c ?? 0 };
  },

  async getByIdWithKey(db: Db, id: string): Promise<AgentRunListItem | null> {
    const rows = await db
      .select({
        run: agentRuns,
        apiKeyId: apiKeys.id,
        apiKeyName: apiKeys.name,
      })
      .from(agentRuns)
      .leftJoin(apiKeys, eq(apiKeys.id, agentRuns.apiKeyId))
      .where(eq(agentRuns.id, id))
      .limit(1);
    const r = rows[0];
    if (!r) return null;
    return {
      ...r.run,
      apiKey: r.apiKeyId && r.apiKeyName ? { id: r.apiKeyId, name: r.apiKeyName } : null,
    };
  },

  /**
   * Aggregate counts + p50/p95 latency over a time window.
   *
   * `from`/`to` are both **inclusive** if supplied; an unbounded side defaults
   * to "all rows on that side". Returns zeroed-out fields when the window is
   * empty (so the dashboard can render `0` rather than `--`).
   */
  async summary(db: Db, range: { from?: Date; to?: Date } = {}): Promise<AgentRunSummary> {
    const where = buildWhere({ ...range });
    const rows = await db
      .select({
        total: sql<number>`count(*)::int`,
        succeeded: sql<number>`count(*) filter (where ${agentRuns.status} = 'success')::int`,
        failed: sql<number>`count(*) filter (where ${agentRuns.status} = 'failed')::int`,
        p50: sql<
          number | null
        >`percentile_cont(0.5)  within group (order by ${agentRuns.durationMs})::int`,
        p95: sql<
          number | null
        >`percentile_cont(0.95) within group (order by ${agentRuns.durationMs})::int`,
        activeKeys: sql<number>`count(distinct ${agentRuns.apiKeyId})::int`,
      })
      .from(agentRuns)
      .where(where);
    const r = rows[0];
    return {
      total: r?.total ?? 0,
      succeeded: r?.succeeded ?? 0,
      failed: r?.failed ?? 0,
      p50DurationMs: r?.p50 ?? null,
      p95DurationMs: r?.p95 ?? null,
      activeKeys: r?.activeKeys ?? 0,
    };
  },

  /** Daily housekeeping. Returns the number of rows deleted. */
  async pruneOlderThan(db: Db, days: number): Promise<number> {
    const cutoff = new Date(Date.now() - days * 86_400_000);
    const rows = await db
      .delete(agentRuns)
      .where(lte(agentRuns.createdAt, cutoff))
      .returning({ id: agentRuns.id });
    return rows.length;
  },
};
