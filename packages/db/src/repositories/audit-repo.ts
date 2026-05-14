/**
 * Audit runs + findings repository.
 *
 * Both SEO and Lighthouse share these tables (`audit_runs` / `audit_findings`)
 * — the row's `auditType` discriminates. The repo intentionally exposes a
 * small surface (`startRun` / `finishRun` / `addFinding`) so the service
 * layers don't have to think about transactions.
 */
import { and, asc, count, desc, eq, type SQL } from 'drizzle-orm';

import type { Db } from '../client.js';
import {
  auditFindings,
  auditRuns,
  type AuditFinding,
  type AuditRun,
  type AuditStatus,
  type AuditType,
  type FindingSeverity,
  type NewAuditFinding,
  type NewAuditRun,
} from '../schema/audits.js';

export type AuditListFilters = {
  siteId?: string | undefined;
  auditType?: AuditType | AuditType[] | undefined;
  status?: AuditStatus | undefined;
};

export type AuditListOptions = {
  filters?: AuditListFilters;
  page?: number;
  limit?: number;
};

function whereForList(filters: AuditListFilters | undefined): SQL | undefined {
  const f = filters ?? {};
  const clauses: SQL[] = [];
  if (f.siteId) clauses.push(eq(auditRuns.siteId, f.siteId));
  if (f.auditType) {
    const arr = Array.isArray(f.auditType) ? f.auditType : [f.auditType];
    if (arr.length === 1) clauses.push(eq(auditRuns.auditType, arr[0]!));
    else if (arr.length > 1) {
      // OR of equality — simpler than `inArray` for tests that pass `as never`.
      const orClause = arr
        .map((t) => eq(auditRuns.auditType, t))
        .reduce<SQL | null>((acc, c) => (acc ? acc : c), null);
      if (orClause) clauses.push(orClause);
    }
  }
  if (f.status) clauses.push(eq(auditRuns.status, f.status));
  if (clauses.length === 0) return undefined;
  return clauses.length === 1 ? clauses[0] : and(...clauses);
}

export const auditRepo = {
  async startRun(db: Db, input: { siteId: string; auditType: AuditType }): Promise<AuditRun> {
    const insert: NewAuditRun = {
      siteId: input.siteId,
      auditType: input.auditType,
      status: 'running',
      startedAt: new Date(),
    };
    const rows = await db.insert(auditRuns).values(insert).returning();
    const r = rows[0];
    if (!r) throw new Error('auditRepo.startRun: insert returned no row');
    return r;
  },

  async finishRun(
    db: Db,
    id: string,
    patch: Partial<{
      status: AuditStatus;
      score: number | null;
      summary: Record<string, unknown> | null;
      rawReportPath: string | null;
    }>,
  ): Promise<AuditRun | null> {
    const rows = await db
      .update(auditRuns)
      .set({
        finishedAt: new Date(),
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        ...(patch.score !== undefined ? { score: patch.score } : {}),
        ...(patch.summary !== undefined ? { summary: patch.summary } : {}),
        ...(patch.rawReportPath !== undefined ? { rawReportPath: patch.rawReportPath } : {}),
      })
      .where(eq(auditRuns.id, id))
      .returning();
    return rows[0] ?? null;
  },

  async getRun(db: Db, id: string): Promise<AuditRun | null> {
    const rows = await db.select().from(auditRuns).where(eq(auditRuns.id, id)).limit(1);
    return rows[0] ?? null;
  },

  async list(
    db: Db,
    opts: AuditListOptions = {},
  ): Promise<{ items: AuditRun[]; page: number; limit: number; total: number }> {
    const page = Math.max(1, opts.page ?? 1);
    const limit = Math.min(100, Math.max(1, opts.limit ?? 20));
    const offset = (page - 1) * limit;
    const where = whereForList(opts.filters);
    const items = await db
      .select()
      .from(auditRuns)
      .where(where)
      .orderBy(desc(auditRuns.startedAt))
      .limit(limit)
      .offset(offset);
    const totalRow = await db.select({ count: count() }).from(auditRuns).where(where);
    return { items, page, limit, total: Number(totalRow[0]?.count ?? 0) };
  },

  async addFinding(db: Db, input: NewAuditFinding): Promise<AuditFinding> {
    const rows = await db.insert(auditFindings).values(input).returning();
    const r = rows[0];
    if (!r) throw new Error('auditRepo.addFinding: insert returned no row');
    return r;
  },

  async listFindings(
    db: Db,
    auditRunId: string,
    opts: { severity?: FindingSeverity | undefined } = {},
  ): Promise<AuditFinding[]> {
    const clauses: SQL[] = [eq(auditFindings.auditRunId, auditRunId)];
    if (opts.severity) clauses.push(eq(auditFindings.severity, opts.severity));
    const where = clauses.length === 1 ? clauses[0] : and(...clauses);
    return db.select().from(auditFindings).where(where).orderBy(asc(auditFindings.severity));
  },
};
