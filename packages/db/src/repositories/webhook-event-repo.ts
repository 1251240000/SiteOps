/**
 * Webhook-events repository.
 *
 * Persists every inbound webhook delivery (signature-failed ones included)
 * and exposes the read paths the service + admin replay use.
 *
 * Two important properties of this layer:
 *
 *   - `create(...)` short-circuits to `null` on Postgres unique-violation
 *     (23505) instead of throwing. This is how `(provider, delivery_id)`
 *     idempotency surfaces to the service: a `null` return → duplicate
 *     delivery, look up the existing row and return it.
 *
 *   - All mutating helpers (`markProcessed`, `markFailed`) are no-ops if
 *     the row id doesn't exist, so race-y replay paths don't blow up.
 */
import { and, desc, eq, isNotNull, isNull, lte, sql, type SQL } from 'drizzle-orm';

import type { Db } from '../client.js';
import {
  webhookEvents,
  type NewWebhookEvent,
  type WebhookEvent,
  type WebhookProvider,
} from '../schema/webhook-events.js';

export type { WebhookEvent, WebhookProvider };

export type WebhookEventListFilters = {
  provider?: WebhookProvider | undefined;
  eventType?: string | undefined;
  /** `true` → only `signature_ok=true`; `false` → only failed. Undefined → both. */
  signatureOk?: boolean | undefined;
  /** `'processed' | 'failed' | 'pending'` */
  state?: 'processed' | 'failed' | 'pending' | undefined;
};

export type WebhookEventListOptions = {
  filters?: WebhookEventListFilters;
  page?: number;
  limit?: number;
};

export type WebhookEventListPage = {
  items: WebhookEvent[];
  page: number;
  limit: number;
  total: number;
};

function buildWhere(filters: WebhookEventListFilters | undefined): SQL | undefined {
  const f = filters ?? {};
  const clauses: SQL[] = [];

  if (f.provider) clauses.push(eq(webhookEvents.provider, f.provider));
  if (f.eventType) clauses.push(eq(webhookEvents.eventType, f.eventType));
  if (f.signatureOk !== undefined) clauses.push(eq(webhookEvents.signatureOk, f.signatureOk));
  if (f.state === 'processed') clauses.push(isNotNull(webhookEvents.processedAt));
  else if (f.state === 'failed') clauses.push(isNotNull(webhookEvents.error));
  else if (f.state === 'pending') {
    clauses.push(isNull(webhookEvents.processedAt));
    clauses.push(isNull(webhookEvents.error));
  }

  if (clauses.length === 0) return undefined;
  return clauses.length === 1 ? clauses[0] : and(...clauses);
}

/** Recognises Postgres unique-violation surfaced by drizzle / postgres-js / pglite. */
function isUniqueViolation(err: unknown): boolean {
  // Walk the cause chain — drizzle sometimes wraps pg errors, pglite throws
  // them directly, and Error.cause is the standard escape hatch for both.
  let cursor: unknown = err;
  const seen = new Set<unknown>();
  while (cursor && typeof cursor === 'object' && !seen.has(cursor)) {
    seen.add(cursor);
    const obj = cursor as { code?: unknown; message?: unknown; cause?: unknown };
    if (typeof obj.code === 'string' && obj.code === '23505') return true;
    if (typeof obj.message === 'string' && /23505|duplicate key value/i.test(obj.message)) {
      return true;
    }
    cursor = obj.cause;
  }
  return false;
}

export const webhookEventRepo = {
  async getById(db: Db, id: string): Promise<WebhookEvent | null> {
    const rows = await db.select().from(webhookEvents).where(eq(webhookEvents.id, id)).limit(1);
    return rows[0] ?? null;
  },

  async findByDelivery(
    db: Db,
    provider: WebhookProvider,
    deliveryId: string,
  ): Promise<WebhookEvent | null> {
    const rows = await db
      .select()
      .from(webhookEvents)
      .where(and(eq(webhookEvents.provider, provider), eq(webhookEvents.deliveryId, deliveryId)))
      .limit(1);
    return rows[0] ?? null;
  },

  /**
   * Insert a new event. Returns `null` on `(provider, delivery_id)` unique
   * violation — the service then loads the existing row via `findByDelivery`
   * and replies `duplicate=true`. Any other DB error still surfaces.
   */
  async create(db: Db, input: NewWebhookEvent): Promise<WebhookEvent | null> {
    try {
      const rows = await db.insert(webhookEvents).values(input).returning();
      const row = rows[0];
      if (!row) throw new Error('webhookEventRepo.create: insert returned no row');
      return row;
    } catch (err) {
      if (isUniqueViolation(err)) return null;
      throw err;
    }
  },

  async list(db: Db, opts: WebhookEventListOptions = {}): Promise<WebhookEventListPage> {
    const page = Math.max(1, opts.page ?? 1);
    const limit = Math.min(100, Math.max(1, opts.limit ?? 50));
    const offset = (page - 1) * limit;
    const where = buildWhere(opts.filters);

    const items = where
      ? await db
          .select()
          .from(webhookEvents)
          .where(where)
          .orderBy(desc(webhookEvents.createdAt))
          .limit(limit)
          .offset(offset)
      : await db
          .select()
          .from(webhookEvents)
          .orderBy(desc(webhookEvents.createdAt))
          .limit(limit)
          .offset(offset);

    const totalRows = where
      ? await db
          .select({ count: sql<number>`count(*)::int` })
          .from(webhookEvents)
          .where(where)
      : await db.select({ count: sql<number>`count(*)::int` }).from(webhookEvents);
    const total = totalRows[0]?.count ?? 0;

    return { items, page, limit, total };
  },

  /** Mark a row as successfully dispatched. No-op when id is missing. */
  async markProcessed(
    db: Db,
    id: string,
    fields: { siteId?: string | null } = {},
  ): Promise<WebhookEvent | null> {
    const patch: Partial<NewWebhookEvent> = {
      processedAt: new Date(),
      error: null,
    };
    if (fields.siteId !== undefined) patch.siteId = fields.siteId;
    const rows = await db
      .update(webhookEvents)
      .set(patch)
      .where(eq(webhookEvents.id, id))
      .returning();
    return rows[0] ?? null;
  },

  /** Mark a row as failed; bumps attempts so replay can audit retries. */
  async markFailed(db: Db, id: string, errMsg: string): Promise<WebhookEvent | null> {
    const rows = await db
      .update(webhookEvents)
      .set({
        error: errMsg.slice(0, 2000),
        processedAt: null,
        attempts: sql`${webhookEvents.attempts} + 1`,
      })
      .where(eq(webhookEvents.id, id))
      .returning();
    return rows[0] ?? null;
  },

  /**
   * Housekeeping helper — removes processed rows older than `days`.
   * Signature-failed rows are *preserved* even past the cutoff, since their
   * audit value goes up over time. Returns the number of rows deleted.
   */
  async pruneProcessedOlderThan(db: Db, days: number): Promise<number> {
    if (!Number.isFinite(days) || days <= 0) return 0;
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const rows = await db
      .delete(webhookEvents)
      .where(
        and(
          isNotNull(webhookEvents.processedAt),
          lte(webhookEvents.createdAt, cutoff),
          eq(webhookEvents.signatureOk, true),
        ),
      )
      .returning({ id: webhookEvents.id });
    return rows.length;
  },
};
