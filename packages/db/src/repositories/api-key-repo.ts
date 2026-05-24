/**
 * API-keys repository.
 *
 * Handles the read paths for the settings dashboard, plus revocation.
 *
 * **Issuance** (writing a new row) lives in `apiKeyService.create` because it
 * mixes Drizzle inserts with bcrypt hashing — that side-effect chain is
 * better expressed at the service layer than here. This file only does the
 * straight-line CRUD that has no policy attached to it.
 */
import { and, asc, desc, eq, isNotNull, isNull, sql, type SQL } from 'drizzle-orm';

import type { Db } from '../client.js';
import { apiKeys, type ApiKey, type NewApiKey } from '../schema/api-keys.js';

/** Safe view of an api_keys row — *never* leaks `key_hash`. */
export type ApiKeyView = Omit<ApiKey, 'keyHash'>;

export type ApiKeyListFilters = {
  /** `'active' | 'revoked' | 'expired'`. Default: all rows. */
  state?: 'active' | 'revoked' | 'expired' | undefined;
};

export type ApiKeyListOptions = {
  filters?: ApiKeyListFilters;
  /** `-created_at` (default), `created_at`, `-last_used_at`, `name`. */
  sort?: '-created_at' | 'created_at' | '-last_used_at' | 'name' | undefined;
  page?: number;
  limit?: number;
};

export type ApiKeyListPage = {
  items: ApiKeyView[];
  page: number;
  limit: number;
  total: number;
};

const SAFE_COLUMNS = {
  id: apiKeys.id,
  name: apiKeys.name,
  keyPrefix: apiKeys.keyPrefix,
  scopes: apiKeys.scopes,
  rateLimitPerMin: apiKeys.rateLimitPerMin,
  lastUsedAt: apiKeys.lastUsedAt,
  expiresAt: apiKeys.expiresAt,
  revokedAt: apiKeys.revokedAt,
  createdAt: apiKeys.createdAt,
} as const;

function buildWhere(filters: ApiKeyListFilters | undefined): SQL | undefined {
  const f = filters ?? {};
  const clauses: SQL[] = [];
  const now = new Date();
  if (f.state === 'active') {
    clauses.push(isNull(apiKeys.revokedAt));
    clauses.push(
      sql`(${apiKeys.expiresAt} IS NULL OR ${apiKeys.expiresAt} > ${now.toISOString()})`,
    );
  } else if (f.state === 'revoked') {
    clauses.push(isNotNull(apiKeys.revokedAt));
  } else if (f.state === 'expired') {
    clauses.push(isNull(apiKeys.revokedAt));
    clauses.push(isNotNull(apiKeys.expiresAt));
    clauses.push(sql`${apiKeys.expiresAt} <= ${now.toISOString()}`);
  }
  if (clauses.length === 0) return undefined;
  return clauses.length === 1 ? clauses[0] : and(...clauses);
}

function sortClause(sort: ApiKeyListOptions['sort']): SQL {
  switch (sort) {
    case 'created_at':
      return asc(apiKeys.createdAt);
    case '-last_used_at':
      return sql`${apiKeys.lastUsedAt} DESC NULLS LAST`;
    case 'name':
      return asc(apiKeys.name);
    case '-created_at':
    case undefined:
    default:
      return desc(apiKeys.createdAt);
  }
}

export const apiKeyRepo = {
  async list(db: Db, opts: ApiKeyListOptions = {}): Promise<ApiKeyListPage> {
    const page = Math.max(1, opts.page ?? 1);
    const limit = Math.min(100, Math.max(1, opts.limit ?? 50));
    const offset = (page - 1) * limit;
    const where = buildWhere(opts.filters);
    const orderBy = sortClause(opts.sort);

    const items = where
      ? await db
          .select(SAFE_COLUMNS)
          .from(apiKeys)
          .where(where)
          .orderBy(orderBy)
          .limit(limit)
          .offset(offset)
      : await db.select(SAFE_COLUMNS).from(apiKeys).orderBy(orderBy).limit(limit).offset(offset);

    const totalRows = where
      ? await db
          .select({ count: sql<number>`count(*)::int` })
          .from(apiKeys)
          .where(where)
      : await db.select({ count: sql<number>`count(*)::int` }).from(apiKeys);
    const total = totalRows[0]?.count ?? 0;

    return { items, page, limit, total };
  },

  async getById(db: Db, id: string): Promise<ApiKeyView | null> {
    const rows = await db.select(SAFE_COLUMNS).from(apiKeys).where(eq(apiKeys.id, id)).limit(1);
    return rows[0] ?? null;
  },

  /** Insert a new row. Caller (service) must have already hashed the key. */
  async create(db: Db, input: NewApiKey): Promise<ApiKeyView> {
    const rows = await db.insert(apiKeys).values(input).returning(SAFE_COLUMNS);
    const row = rows[0];
    if (!row) throw new Error('apiKeyRepo.create: insert returned no row');
    return row;
  },

  /** Set `revoked_at = now()` if not already revoked. Returns the updated row, or `null` when id missing. */
  async revoke(db: Db, id: string): Promise<ApiKeyView | null> {
    const rows = await db
      .update(apiKeys)
      .set({ revokedAt: new Date() })
      .where(and(eq(apiKeys.id, id), isNull(apiKeys.revokedAt)))
      .returning(SAFE_COLUMNS);
    if (rows.length > 0) return rows[0]!;
    // Either the id is unknown OR the row was already revoked. Surface the
    // current state regardless so the route can render an idempotent response.
    return this.getById(db, id);
  },

  /**
   * Update mutable fields on an active key. Currently the only mutable field
   * is `rate_limit_per_min`; pass `null` to clear the override (key falls
   * back to the env default). Refuses to update revoked rows.
   */
  async updateRateLimit(
    db: Db,
    id: string,
    rateLimitPerMin: number | null,
  ): Promise<ApiKeyView | null> {
    const rows = await db
      .update(apiKeys)
      .set({ rateLimitPerMin })
      .where(and(eq(apiKeys.id, id), isNull(apiKeys.revokedAt)))
      .returning(SAFE_COLUMNS);
    return rows[0] ?? null;
  },

  /** Count of active (non-revoked, non-expired) keys. Used for the {API_KEY_MAX_ACTIVE} cap. */
  async countActive(db: Db): Promise<number> {
    const now = new Date();
    const rows = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(apiKeys)
      .where(
        and(
          isNull(apiKeys.revokedAt),
          sql`(${apiKeys.expiresAt} IS NULL OR ${apiKeys.expiresAt} > ${now.toISOString()})`,
        ),
      );
    return rows[0]?.count ?? 0;
  },
};
