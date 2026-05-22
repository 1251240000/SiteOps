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
import { and, asc, count, desc, eq, gte, ilike, lt, lte, or, sql, type SQL } from 'drizzle-orm';

import { clampLimit, encodeCursor, type Cursor } from '@siteops/shared';

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
  /** Legacy 1-indexed page. Ignored when `cursor` is supplied. */
  page?: number;
  /** Row cap; always clamped to `[1, 100]`. */
  limit?: number;
  /**
   * Decoded keyset cursor. When supplied, the repo switches to keyset mode:
   * `total` is returned as `0` (uncomputed — saves the `count(*)` round trip)
   * and `nextCursor` / `hasMore` describe the follow-up page. The route
   * layer is responsible for decoding the wire string into a `Cursor`.
   */
  cursor?: Cursor;
};

export type AgentRunListItem = AgentRun & {
  apiKey: { id: string; name: string } | null;
};

export type AgentRunListPage = {
  items: AgentRunListItem[];
  /** Echoed back unchanged in offset mode; `1` in cursor mode (placeholder). */
  page: number;
  limit: number;
  /** Filter-matched count. `0` in cursor mode — callers must not rely on it. */
  total: number;
  /** Set in cursor mode (or `null` on the final page). */
  nextCursor: string | null;
  /** `true` iff a follow-up cursor was returned. Always `false` in offset mode. */
  hasMore: boolean;
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
    const limit = clampLimit(opts.limit, 50);
    const filterWhere = buildWhere(opts.filters);
    // The repo always sorts by `created_at` (asc/desc). The cursor path
    // hard-codes DESC so the keyset comparison stays correct — ascending
    // cursor mode is intentionally out of scope (no consumer uses it).
    if (opts.cursor) {
      const c = opts.cursor;
      const cursorTs = new Date(c.ts);
      const keysetWhere = or(
        lt(agentRuns.createdAt, cursorTs),
        and(eq(agentRuns.createdAt, cursorTs), lt(agentRuns.id, c.id)),
      );
      const where = filterWhere ? and(filterWhere, keysetWhere) : keysetWhere;

      // Fetch one extra row to compute hasMore without a second round trip.
      const rows = await db
        .select({
          run: agentRuns,
          apiKeyId: apiKeys.id,
          apiKeyName: apiKeys.name,
        })
        .from(agentRuns)
        .leftJoin(apiKeys, eq(apiKeys.id, agentRuns.apiKeyId))
        .where(where)
        .orderBy(desc(agentRuns.createdAt), desc(agentRuns.id))
        .limit(limit + 1);

      const hasMore = rows.length > limit;
      const sliced = hasMore ? rows.slice(0, limit) : rows;
      const items: AgentRunListItem[] = sliced.map((r) => ({
        ...r.run,
        apiKey: r.apiKeyId && r.apiKeyName ? { id: r.apiKeyId, name: r.apiKeyName } : null,
      }));
      const last = items[items.length - 1];
      const nextCursor =
        hasMore && last ? encodeCursor({ id: last.id, ts: last.createdAt.toISOString() }) : null;
      return { items, page: 1, limit, total: 0, nextCursor, hasMore };
    }

    const page = Math.max(1, opts.page ?? 1);
    const offset = (page - 1) * limit;
    const sortDesc = opts.sort !== 'created_at';
    const orderBy = sortDesc ? desc(agentRuns.createdAt) : asc(agentRuns.createdAt);

    const rows = await db
      .select({
        run: agentRuns,
        apiKeyId: apiKeys.id,
        apiKeyName: apiKeys.name,
      })
      .from(agentRuns)
      .leftJoin(apiKeys, eq(apiKeys.id, agentRuns.apiKeyId))
      .where(filterWhere)
      .orderBy(orderBy)
      .limit(limit)
      .offset(offset);

    const items: AgentRunListItem[] = rows.map((r) => ({
      ...r.run,
      apiKey: r.apiKeyId && r.apiKeyName ? { id: r.apiKeyId, name: r.apiKeyName } : null,
    }));

    const totalRow = await db.select({ c: count() }).from(agentRuns).where(filterWhere);
    const total = totalRow[0]?.c ?? 0;

    // In offset mode we also emit a forward cursor so callers can switch
    // to keyset mode after page 1 without an awkward bootstrap. Only safe
    // when the sort matches cursor semantics (DESC) — ASC walks fall back
    // to `nextCursor=null`.
    const hasMore = page * limit < total;
    const last = items[items.length - 1];
    const nextCursor =
      sortDesc && hasMore && last
        ? encodeCursor({ id: last.id, ts: last.createdAt.toISOString() })
        : null;

    return {
      items,
      page,
      limit,
      total,
      nextCursor,
      hasMore,
    };
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
