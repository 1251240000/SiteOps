/**
 * Sites repository.
 *
 * All SQL touching the `sites` table funnels through this module. Service
 * code (`@siteops/services`) imports these helpers; route handlers never
 * call Drizzle directly. The repo accepts the `Db` type from the prod
 * client, while tests pass the PGlite-backed handle via `as never` — the
 * Drizzle query API is the same across both drivers.
 */
import { and, asc, desc, eq, ilike, inArray, ne, or, sql, type SQL } from 'drizzle-orm';

import type { Db } from '../client.js';
import { sites, type NewSite, type Site, type SiteStatus, type SiteType } from '../schema/sites.js';

export type SiteListFilters = {
  q?: string | undefined;
  siteType?: SiteType | SiteType[] | undefined;
  status?: SiteStatus | SiteStatus[] | undefined;
  country?: string | undefined;
  tag?: string | undefined;
  /** When false (default), `status='archived'` rows are hidden unless the
   *  caller passes an explicit `status` filter that includes 'archived'. */
  includeArchived?: boolean | undefined;
};

export type SiteListSort =
  | 'created_at'
  | '-created_at'
  | 'health_score'
  | '-health_score'
  | 'name'
  | '-name';

export type SiteListOptions = {
  filters?: SiteListFilters;
  sort?: SiteListSort;
  /** 1-indexed offset page. */
  page?: number;
  limit?: number;
};

export type SiteListPage = {
  items: Site[];
  page: number;
  limit: number;
  total: number;
};

function toArray<T>(v: T | T[] | undefined): T[] | undefined {
  if (v === undefined) return undefined;
  return Array.isArray(v) ? v : [v];
}

function buildWhere(filters: SiteListFilters | undefined): SQL | undefined {
  const f = filters ?? {};
  const clauses: SQL[] = [];

  if (f.q && f.q.trim().length > 0) {
    const pattern = `%${f.q.trim()}%`;
    const orClause = or(
      ilike(sites.name, pattern),
      ilike(sites.slug, pattern),
      ilike(sites.primaryUrl, pattern),
    );
    if (orClause) clauses.push(orClause);
  }

  const types = toArray(f.siteType);
  if (types && types.length > 0) {
    clauses.push(inArray(sites.siteType, types));
  }

  const statuses = toArray(f.status);
  if (statuses && statuses.length > 0) {
    clauses.push(inArray(sites.status, statuses));
  } else if (!f.includeArchived) {
    clauses.push(ne(sites.status, 'archived'));
  }

  if (f.country) {
    clauses.push(eq(sites.targetCountry, f.country));
  }

  if (f.tag) {
    clauses.push(sql`${sites.tags} @> ARRAY[${f.tag}]::text[]`);
  }

  if (clauses.length === 0) return undefined;
  return clauses.length === 1 ? clauses[0] : and(...clauses);
}

function sortClause(sort: SiteListSort | undefined): SQL {
  switch (sort) {
    case 'created_at':
      return asc(sites.createdAt);
    case 'health_score':
      return asc(sites.healthScore);
    case '-health_score':
      return desc(sites.healthScore);
    case 'name':
      return asc(sites.name);
    case '-name':
      return desc(sites.name);
    case '-created_at':
    case undefined:
    default:
      return desc(sites.createdAt);
  }
}

export const siteRepo = {
  async list(db: Db, opts: SiteListOptions = {}): Promise<SiteListPage> {
    const page = Math.max(1, opts.page ?? 1);
    const limit = Math.min(100, Math.max(1, opts.limit ?? 20));
    const offset = (page - 1) * limit;
    const where = buildWhere(opts.filters);
    const order = sortClause(opts.sort);

    // Drizzle's fluent builder is split into 2 queries here (list + count).
    // Cheaper than `count(*) over ()` because Drizzle returns rows in plain
    // JSON-friendly shape rather than projecting an extra column on every row.
    const items = await db
      .select()
      .from(sites)
      .where(where)
      .orderBy(order)
      .limit(limit)
      .offset(offset);

    const totalRow = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(sites)
      .where(where);
    const total = totalRow[0]?.count ?? 0;

    return { items, page, limit, total };
  },

  async getById(db: Db, id: string): Promise<Site | null> {
    const rows = await db.select().from(sites).where(eq(sites.id, id)).limit(1);
    return rows[0] ?? null;
  },

  async getBySlug(db: Db, slug: string): Promise<Site | null> {
    const rows = await db.select().from(sites).where(eq(sites.slug, slug)).limit(1);
    return rows[0] ?? null;
  },

  /**
   * Look up a site whose Cloudflare Pages project name matches exactly.
   * Used by the T27 CF webhook dispatcher to attach the inbound delivery
   * to the right `sites.id` row.
   */
  async findByCfPagesProject(db: Db, project: string): Promise<Site | null> {
    if (!project) return null;
    const rows = await db.select().from(sites).where(eq(sites.cfPagesProject, project)).limit(1);
    return rows[0] ?? null;
  },

  /**
   * Look up a site whose `repo_url` resolves to a given GitHub
   * `owner/repo` pair (case-insensitive). T27 GitHub webhook dispatcher
   * uses this when the payload only carries `repository.full_name`.
   */
  async findByGithubRepo(db: Db, ownerRepo: string): Promise<Site | null> {
    if (!ownerRepo) return null;
    // Sites store the repo as a free-form URL, e.g. `https://github.com/owner/repo`,
    // `git@github.com:owner/repo.git`, or just `owner/repo`. An `ilike` on the
    // canonical `owner/repo` substring is good enough; collisions across
    // sites are not expected at our scale.
    const needle = `%${ownerRepo}%`;
    const rows = await db.select().from(sites).where(ilike(sites.repoUrl, needle)).limit(1);
    return rows[0] ?? null;
  },

  /** Slugs equal to `base` or shaped like `base-<n>`. Used by the slug picker. */
  async slugsLikeBase(db: Db, base: string): Promise<string[]> {
    const where = or(eq(sites.slug, base), ilike(sites.slug, `${base}-%`));
    const rows = await db.select({ slug: sites.slug }).from(sites).where(where);
    return rows.map((r) => r.slug);
  },

  async create(db: Db, input: NewSite): Promise<Site> {
    const rows = await db.insert(sites).values(input).returning();
    const row = rows[0];
    if (!row) throw new Error('siteRepo.create: insert returned no row');
    return row;
  },

  async update(db: Db, id: string, patch: Partial<NewSite>): Promise<Site | null> {
    const rows = await db.update(sites).set(patch).where(eq(sites.id, id)).returning();
    return rows[0] ?? null;
  },

  async archive(db: Db, id: string): Promise<Site | null> {
    return this.update(db, id, { status: 'archived' });
  },

  /** Active sites — minimal fields the scheduler needs. */
  async listActive(
    db: Db,
  ): Promise<Array<{ id: string; primaryUrl: string; healthScore: number }>> {
    return db
      .select({
        id: sites.id,
        primaryUrl: sites.primaryUrl,
        healthScore: sites.healthScore,
      })
      .from(sites)
      .where(eq(sites.status, 'active'));
  },
};
