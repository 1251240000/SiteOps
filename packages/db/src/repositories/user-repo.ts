/**
 * Users repository (T40).
 *
 * Handles listing, lookup, creation, and updates for the `users` table.
 * Password hashing is the service layer's job — this repo only persists
 * pre-hashed values.
 */
import { and, desc, eq, sql, type SQL } from 'drizzle-orm';

import type { Db } from '../client.js';
import { users, type NewUser, type User } from '../schema/users.js';

/** Safe view — never leaks `password_hash`. */
export type UserView = Omit<User, 'passwordHash'>;

const SAFE_COLUMNS = {
  id: users.id,
  email: users.email,
  name: users.name,
  role: users.role,
  status: users.status,
  invitedBy: users.invitedBy,
  invitedAt: users.invitedAt,
  lastLoginAt: users.lastLoginAt,
  createdAt: users.createdAt,
  updatedAt: users.updatedAt,
} as const;

export type UserListFilters = {
  status?: string | undefined;
  role?: string | undefined;
};

export type UserListOptions = {
  filters?: UserListFilters;
  page?: number;
  limit?: number;
};

export type UserListPage = {
  items: UserView[];
  page: number;
  limit: number;
  total: number;
};

function buildWhere(filters: UserListFilters | undefined): SQL | undefined {
  const f = filters ?? {};
  const clauses: SQL[] = [];
  if (f.status) clauses.push(eq(users.status, f.status));
  if (f.role) clauses.push(eq(users.role, f.role));
  if (clauses.length === 0) return undefined;
  return clauses.length === 1 ? clauses[0]! : and(...clauses);
}

export const userRepo = {
  async list(db: Db, opts: UserListOptions = {}): Promise<UserListPage> {
    const page = Math.max(1, opts.page ?? 1);
    const limit = Math.min(100, Math.max(1, opts.limit ?? 50));
    const offset = (page - 1) * limit;
    const where = buildWhere(opts.filters);
    const orderBy = desc(users.createdAt);

    const items = where
      ? await db
          .select(SAFE_COLUMNS)
          .from(users)
          .where(where)
          .orderBy(orderBy)
          .limit(limit)
          .offset(offset)
      : await db.select(SAFE_COLUMNS).from(users).orderBy(orderBy).limit(limit).offset(offset);

    const totalRows = where
      ? await db
          .select({ count: sql<number>`count(*)::int` })
          .from(users)
          .where(where)
      : await db.select({ count: sql<number>`count(*)::int` }).from(users);
    const total = totalRows[0]?.count ?? 0;

    return { items, page, limit, total };
  },

  async getById(db: Db, id: string): Promise<UserView | null> {
    const rows = await db.select(SAFE_COLUMNS).from(users).where(eq(users.id, id)).limit(1);
    return rows[0] ?? null;
  },

  async getByEmail(db: Db, email: string): Promise<UserView | null> {
    const rows = await db
      .select(SAFE_COLUMNS)
      .from(users)
      .where(eq(users.email, email.trim().toLowerCase()))
      .limit(1);
    return rows[0] ?? null;
  },

  async create(db: Db, input: NewUser): Promise<UserView> {
    const rows = await db.insert(users).values(input).returning(SAFE_COLUMNS);
    const row = rows[0];
    if (!row) throw new Error('userRepo.create: insert returned no row');
    return row;
  },

  async update(
    db: Db,
    id: string,
    data: Partial<Pick<User, 'role' | 'status' | 'name' | 'lastLoginAt'>>,
  ): Promise<UserView | null> {
    const rows = await db.update(users).set(data).where(eq(users.id, id)).returning(SAFE_COLUMNS);
    return rows[0] ?? null;
  },

  async stampLastLogin(db: Db, id: string): Promise<void> {
    await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, id));
  },

  async count(db: Db): Promise<number> {
    const rows = await db.select({ count: sql<number>`count(*)::int` }).from(users);
    return rows[0]?.count ?? 0;
  },
};
