/**
 * Deployments repository.
 *
 * Mirrors the layout of `siteRepo` / `domainRepo`. The "interesting" bit is
 * `upsertByProviderId`: webhooks fire-and-forget so we treat the
 * `(provider, provider_deployment_id)` pair as the dedup key (partial unique
 * index added in 0001_deployments_idempotency_uk.sql).
 */
import { and, asc, desc, eq, ilike, inArray, or, sql, type SQL } from 'drizzle-orm';

import type { Db } from '../client.js';
import {
  deployments,
  type Deployment,
  type DeploymentProvider,
  type DeploymentStatus,
  type NewDeployment,
} from '../schema/deployments.js';

export type DeploymentListFilters = {
  q?: string | undefined;
  siteId?: string | undefined;
  status?: DeploymentStatus | DeploymentStatus[] | undefined;
  provider?: DeploymentProvider | DeploymentProvider[] | undefined;
};

export type DeploymentListSort = 'started_at' | '-started_at' | 'created_at' | '-created_at';

export type DeploymentListOptions = {
  filters?: DeploymentListFilters;
  sort?: DeploymentListSort;
  page?: number;
  limit?: number;
};

export type DeploymentListPage = {
  items: Deployment[];
  page: number;
  limit: number;
  total: number;
};

function toArray<T>(v: T | T[] | undefined): T[] | undefined {
  if (v === undefined) return undefined;
  return Array.isArray(v) ? v : [v];
}

function buildWhere(filters: DeploymentListFilters | undefined): SQL | undefined {
  const f = filters ?? {};
  const clauses: SQL[] = [];

  if (f.q && f.q.trim().length > 0) {
    const pattern = `%${f.q.trim()}%`;
    const orClause = or(
      ilike(deployments.commitSha, pattern),
      ilike(deployments.commitMessage, pattern),
      ilike(deployments.branch, pattern),
    );
    if (orClause) clauses.push(orClause);
  }

  if (f.siteId) {
    clauses.push(eq(deployments.siteId, f.siteId));
  }

  const statuses = toArray(f.status);
  if (statuses && statuses.length > 0) {
    clauses.push(inArray(deployments.status, statuses));
  }

  const providers = toArray(f.provider);
  if (providers && providers.length > 0) {
    clauses.push(inArray(deployments.provider, providers));
  }

  if (clauses.length === 0) return undefined;
  return clauses.length === 1 ? clauses[0] : and(...clauses);
}

function sortClause(sort: DeploymentListSort | undefined): SQL {
  switch (sort) {
    case 'started_at':
      return asc(deployments.startedAt);
    case 'created_at':
      return asc(deployments.createdAt);
    case '-created_at':
      return desc(deployments.createdAt);
    case '-started_at':
    case undefined:
    default:
      // `started_at` may be NULL while a deploy is queued; fall back to
      // `createdAt` so brand-new rows still appear at the top.
      return sql`COALESCE(${deployments.startedAt}, ${deployments.createdAt}) DESC`;
  }
}

export const deploymentRepo = {
  async list(db: Db, opts: DeploymentListOptions = {}): Promise<DeploymentListPage> {
    const page = Math.max(1, opts.page ?? 1);
    const limit = Math.min(100, Math.max(1, opts.limit ?? 20));
    const offset = (page - 1) * limit;
    const where = buildWhere(opts.filters);
    const order = sortClause(opts.sort);

    const items = await db
      .select()
      .from(deployments)
      .where(where)
      .orderBy(order)
      .limit(limit)
      .offset(offset);

    const totalRow = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(deployments)
      .where(where);

    return { items, page, limit, total: totalRow[0]?.count ?? 0 };
  },

  async listForSite(db: Db, siteId: string, opts: { limit?: number } = {}): Promise<Deployment[]> {
    const limit = Math.min(200, Math.max(1, opts.limit ?? 50));
    return db
      .select()
      .from(deployments)
      .where(eq(deployments.siteId, siteId))
      .orderBy(sql`COALESCE(${deployments.startedAt}, ${deployments.createdAt}) DESC`)
      .limit(limit);
  },

  async getById(db: Db, id: string): Promise<Deployment | null> {
    const rows = await db.select().from(deployments).where(eq(deployments.id, id)).limit(1);
    return rows[0] ?? null;
  },

  /** Lookup by the idempotency key. Returns `null` when either side is null. */
  async getByProviderId(
    db: Db,
    provider: DeploymentProvider,
    providerDeploymentId: string,
  ): Promise<Deployment | null> {
    if (!providerDeploymentId) return null;
    const rows = await db
      .select()
      .from(deployments)
      .where(
        and(
          eq(deployments.provider, provider),
          eq(deployments.providerDeploymentId, providerDeploymentId),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  },

  async create(db: Db, input: NewDeployment): Promise<Deployment> {
    const rows = await db.insert(deployments).values(input).returning();
    const row = rows[0];
    if (!row) throw new Error('deploymentRepo.create: insert returned no row');
    return row;
  },

  async update(db: Db, id: string, patch: Partial<NewDeployment>): Promise<Deployment | null> {
    const rows = await db.update(deployments).set(patch).where(eq(deployments.id, id)).returning();
    return rows[0] ?? null;
  },
};
