/**
 * Domains repository.
 *
 * Mirrors `siteRepo` in shape and conventions. The one wrinkle: enforcing
 * "at most one primary per site" requires a multi-statement transaction
 * (clear old primary → set new) — `setPrimary` exposes that as a single
 * call so the service doesn't need to think about it.
 */
import { and, asc, desc, eq, ilike, lte, or, sql, type SQL } from 'drizzle-orm';

import type { Db } from '../client.js';
import { domains, type Domain, type NewDomain } from '../schema/domains.js';

export type DomainListFilters = {
  q?: string | undefined;
  siteId?: string | undefined;
  /** Only return rows whose `expires_at` is <= today + N days (NULL excluded). */
  expiringWithinDays?: number | undefined;
};

export type DomainListSort = 'expires_at' | '-expires_at' | 'domain' | '-domain';

export type DomainListOptions = {
  filters?: DomainListFilters;
  sort?: DomainListSort;
  page?: number;
  limit?: number;
};

export type DomainListPage = {
  items: Domain[];
  page: number;
  limit: number;
  total: number;
};

function buildWhere(filters: DomainListFilters | undefined): SQL | undefined {
  const f = filters ?? {};
  const clauses: SQL[] = [];

  if (f.q && f.q.trim().length > 0) {
    const pattern = `%${f.q.trim().toLowerCase()}%`;
    const orClause = or(ilike(domains.domain, pattern), ilike(domains.registrar, pattern));
    if (orClause) clauses.push(orClause);
  }

  if (f.siteId) {
    clauses.push(eq(domains.siteId, f.siteId));
  }

  if (typeof f.expiringWithinDays === 'number') {
    // `current_date + N` is preferable to JS-side math; uses PG's own clock.
    // The explicit `::integer` cast pins the operator overload — without it
    // PG can't resolve `date + unknown` to a unique `date + integer` form.
    clauses.push(
      sql`${domains.expiresAt} IS NOT NULL AND ${domains.expiresAt} <= current_date + (${f.expiringWithinDays})::integer`,
    );
  }

  if (clauses.length === 0) return undefined;
  return clauses.length === 1 ? clauses[0] : and(...clauses);
}

function sortClause(sort: DomainListSort | undefined): SQL {
  switch (sort) {
    case '-expires_at':
      return desc(domains.expiresAt);
    case 'domain':
      return asc(domains.domain);
    case '-domain':
      return desc(domains.domain);
    case 'expires_at':
    case undefined:
    default:
      // NULLs last on asc; Drizzle/PG defaults work for us because we only
      // want non-null dates to bubble up — `daysUntilExpiry` is computed at
      // the service layer and merely uses the row order.
      return asc(domains.expiresAt);
  }
}

export const domainRepo = {
  async list(db: Db, opts: DomainListOptions = {}): Promise<DomainListPage> {
    const page = Math.max(1, opts.page ?? 1);
    const limit = Math.min(200, Math.max(1, opts.limit ?? 50));
    const offset = (page - 1) * limit;
    const where = buildWhere(opts.filters);
    const order = sortClause(opts.sort);

    const items = await db
      .select()
      .from(domains)
      .where(where)
      .orderBy(order)
      .limit(limit)
      .offset(offset);

    const totalRow = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(domains)
      .where(where);

    return { items, page, limit, total: totalRow[0]?.count ?? 0 };
  },

  async listForSite(db: Db, siteId: string): Promise<Domain[]> {
    return db
      .select()
      .from(domains)
      .where(eq(domains.siteId, siteId))
      .orderBy(desc(domains.isPrimary), asc(domains.domain));
  },

  async getById(db: Db, id: string): Promise<Domain | null> {
    const rows = await db.select().from(domains).where(eq(domains.id, id)).limit(1);
    return rows[0] ?? null;
  },

  async getByDomain(db: Db, domain: string): Promise<Domain | null> {
    const rows = await db.select().from(domains).where(eq(domains.domain, domain)).limit(1);
    return rows[0] ?? null;
  },

  async create(db: Db, input: NewDomain): Promise<Domain> {
    const rows = await db.insert(domains).values(input).returning();
    const row = rows[0];
    if (!row) throw new Error('domainRepo.create: insert returned no row');
    return row;
  },

  async update(db: Db, id: string, patch: Partial<NewDomain>): Promise<Domain | null> {
    const rows = await db.update(domains).set(patch).where(eq(domains.id, id)).returning();
    return rows[0] ?? null;
  },

  async delete(db: Db, id: string): Promise<Domain | null> {
    const rows = await db.delete(domains).where(eq(domains.id, id)).returning();
    return rows[0] ?? null;
  },

  /**
   * Atomically transfer `is_primary` to `domainId` (must belong to `siteId`):
   *   1. clear `is_primary` on every other row of that site
   *   2. set `is_primary=true` on the target
   *
   * Returns the row that ended up primary, or `null` if the id didn't match
   * (callers should treat that as a 404).
   */
  async setPrimary(db: Db, siteId: string, domainId: string): Promise<Domain | null> {
    return db.transaction(async (tx) => {
      const target = await tx
        .select()
        .from(domains)
        .where(and(eq(domains.id, domainId), eq(domains.siteId, siteId)))
        .limit(1);
      if (!target[0]) return null;

      await tx
        .update(domains)
        .set({ isPrimary: false })
        .where(and(eq(domains.siteId, siteId), eq(domains.isPrimary, true)));

      const updated = await tx
        .update(domains)
        .set({ isPrimary: true })
        .where(eq(domains.id, domainId))
        .returning();
      return updated[0] ?? null;
    });
  },

  /**
   * Convenience for the service layer's "primary count" sanity check —
   * useful both before insert (warn if a site already has a primary) and
   * in tests asserting setPrimary leaves the invariant intact.
   */
  async countPrimary(db: Db, siteId: string): Promise<number> {
    const rows = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(domains)
      .where(and(eq(domains.siteId, siteId), eq(domains.isPrimary, true)));
    return rows[0]?.count ?? 0;
  },

  /**
   * Bulk fetch by site ids. Used by the site detail page to render the
   * domain card without N+1 queries.
   */
  async listForSites(db: Db, siteIds: string[]): Promise<Domain[]> {
    if (siteIds.length === 0) return [];
    return db
      .select()
      .from(domains)
      .where(or(...siteIds.map((id) => eq(domains.siteId, id)))!)
      .orderBy(desc(domains.isPrimary), asc(domains.domain));
  },

  /**
   * All domains across the registry. Used by the SSL/domain-expiry job.
   * Optionally exclude rows whose owning site is archived.
   */
  async listAll(db: Db): Promise<Domain[]> {
    return db.select().from(domains).orderBy(asc(domains.domain));
  },

  /**
   * Update SSL fields after a TLS probe. `null` clears the column (when the
   * probe failed and we want to mark the data stale). Returns the row.
   */
  async updateSslInfo(
    db: Db,
    id: string,
    patch: { sslExpiresAt?: Date | null; sslIssuer?: string | null },
  ): Promise<Domain | null> {
    const rows = await db
      .update(domains)
      .set({
        ...(patch.sslExpiresAt !== undefined ? { sslExpiresAt: patch.sslExpiresAt } : {}),
        ...(patch.sslIssuer !== undefined ? { sslIssuer: patch.sslIssuer } : {}),
      })
      .where(eq(domains.id, id))
      .returning();
    return rows[0] ?? null;
  },
};

// Re-export the comparison helper for service-layer "near expiry" filters
// that need a JS-side date math (e.g. when running tests outside PG).
export { lte };
