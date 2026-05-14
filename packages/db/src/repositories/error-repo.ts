/**
 * Errors repository.
 *
 * Insert path is an upsert keyed by `(siteId, fingerprint)`: increment
 * `count` + bump `lastSeenAt` if a row already exists, otherwise insert a
 * fresh row. `pruneOlderThan` is used by housekeeping.
 */
import { and, count, desc, eq, gte, ilike, isNull, lte, or, sql, type SQL } from 'drizzle-orm';

import type { Db } from '../client.js';
import {
  errors,
  type ErrorLevel,
  type ErrorRow,
  type ErrorSource,
  type NewErrorRow,
} from '../schema/errors.js';

export type ErrorListFilters = {
  siteId?: string;
  level?: ErrorLevel;
  resolved?: boolean;
  q?: string;
};

export type ErrorListOptions = {
  filters?: ErrorListFilters;
  page?: number;
  limit?: number;
};

function whereForList(f: ErrorListFilters = {}): SQL | undefined {
  const clauses: SQL[] = [];
  if (f.siteId) clauses.push(eq(errors.siteId, f.siteId));
  if (f.level) clauses.push(eq(errors.level, f.level));
  if (f.resolved === true) {
    clauses.push(sql`${errors.resolvedAt} IS NOT NULL`);
  } else if (f.resolved === false) {
    clauses.push(isNull(errors.resolvedAt));
  }
  if (f.q) {
    const pattern = `%${f.q.trim()}%`;
    const orClause = or(ilike(errors.message, pattern), ilike(errors.fingerprint, pattern));
    if (orClause) clauses.push(orClause);
  }
  if (clauses.length === 0) return undefined;
  return clauses.length === 1 ? clauses[0] : and(...clauses);
}

export type UpsertErrorInput = {
  siteId: string;
  source: ErrorSource;
  level: ErrorLevel;
  fingerprint: string;
  message: string;
  stack?: string | null;
  meta?: Record<string, unknown> | null;
  occurredAt?: Date;
};

export const errorRepo = {
  async upsert(db: Db, input: UpsertErrorInput): Promise<{ row: ErrorRow; created: boolean }> {
    const at = input.occurredAt ?? new Date();
    // Try update first; if 0 rows affected, insert.
    const updated = await db
      .update(errors)
      .set({
        count: sql`${errors.count} + 1`,
        lastSeenAt: at,
        // resurrect resolved errors when they fire again
        resolvedAt: null,
        message: input.message,
        stack: input.stack ?? null,
        meta: input.meta ?? null,
        level: input.level,
        source: input.source,
      })
      .where(and(eq(errors.siteId, input.siteId), eq(errors.fingerprint, input.fingerprint)))
      .returning();
    const u = updated[0];
    if (u) return { row: u, created: false };

    const insertRow: NewErrorRow = {
      siteId: input.siteId,
      source: input.source,
      level: input.level,
      fingerprint: input.fingerprint,
      message: input.message,
      stack: input.stack ?? null,
      meta: input.meta ?? null,
      firstSeenAt: at,
      lastSeenAt: at,
      count: 1,
    };
    const inserted = await db.insert(errors).values(insertRow).returning();
    const r = inserted[0];
    if (!r) throw new Error('errorRepo.upsert: insert returned no row');
    return { row: r, created: true };
  },

  async list(
    db: Db,
    opts: ErrorListOptions = {},
  ): Promise<{ items: ErrorRow[]; page: number; limit: number; total: number }> {
    const page = Math.max(1, opts.page ?? 1);
    const limit = Math.min(100, Math.max(1, opts.limit ?? 20));
    const offset = (page - 1) * limit;
    const where = whereForList(opts.filters);
    const items = await db
      .select()
      .from(errors)
      .where(where)
      .orderBy(desc(errors.lastSeenAt))
      .limit(limit)
      .offset(offset);
    const totalRow = await db.select({ count: count() }).from(errors).where(where);
    return { items, page, limit, total: Number(totalRow[0]?.count ?? 0) };
  },

  async getById(db: Db, id: string): Promise<ErrorRow | null> {
    const rows = await db.select().from(errors).where(eq(errors.id, id)).limit(1);
    return rows[0] ?? null;
  },

  async setResolved(db: Db, id: string, resolved: boolean): Promise<ErrorRow | null> {
    const rows = await db
      .update(errors)
      .set({ resolvedAt: resolved ? new Date() : null })
      .where(eq(errors.id, id))
      .returning();
    return rows[0] ?? null;
  },

  /** Number of new errors in `[since, now]` for a given site (alerting). */
  async countSince(db: Db, siteId: string, since: Date): Promise<number> {
    const row = await db
      .select({ count: count() })
      .from(errors)
      .where(and(eq(errors.siteId, siteId), gte(errors.lastSeenAt, since)));
    return Number(row[0]?.count ?? 0);
  },

  async pruneResolvedOlderThan(db: Db, keepDays: number): Promise<number> {
    const cutoff = new Date(Date.now() - keepDays * 24 * 60 * 60 * 1000);
    const res = await db
      .delete(errors)
      .where(and(sql`${errors.resolvedAt} IS NOT NULL`, lte(errors.resolvedAt, cutoff)))
      .returning({ id: errors.id });
    return res.length;
  },
};
