/**
 * Alerts repository.
 *
 * Three tables in one file: rules, channels, alerts (the firings).
 */
import { and, asc, count, desc, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';

import type { Db } from '../client.js';
import {
  alertChannels,
  alertRules,
  alerts,
  type Alert,
  type AlertChannel,
  type AlertMetric,
  type AlertRule,
  type AlertStatus,
  type NewAlert,
  type NewAlertChannel,
  type NewAlertRule,
} from '../schema/alerts.js';

export type RuleListFilters = {
  enabled?: boolean | undefined;
  siteId?: string | undefined;
  metric?: AlertMetric | undefined;
};

function ruleWhere(f: RuleListFilters | undefined): SQL | undefined {
  const filters = f ?? {};
  const clauses: SQL[] = [];
  if (filters.enabled !== undefined) clauses.push(eq(alertRules.enabled, filters.enabled));
  if (filters.siteId) clauses.push(eq(alertRules.siteId, filters.siteId));
  if (filters.metric) clauses.push(eq(alertRules.metric, filters.metric));
  if (clauses.length === 0) return undefined;
  return clauses.length === 1 ? clauses[0] : and(...clauses);
}

export const alertRepo = {
  // -------- Channels --------
  async createChannel(db: Db, input: NewAlertChannel): Promise<AlertChannel> {
    const rows = await db.insert(alertChannels).values(input).returning();
    const r = rows[0];
    if (!r) throw new Error('alertRepo.createChannel: insert returned no row');
    return r;
  },
  async getChannel(db: Db, id: string): Promise<AlertChannel | null> {
    const rows = await db.select().from(alertChannels).where(eq(alertChannels.id, id)).limit(1);
    return rows[0] ?? null;
  },
  async listChannels(db: Db): Promise<AlertChannel[]> {
    return db.select().from(alertChannels).orderBy(asc(alertChannels.createdAt));
  },
  async listChannelsByIds(db: Db, ids: ReadonlyArray<string>): Promise<AlertChannel[]> {
    if (ids.length === 0) return [];
    return db
      .select()
      .from(alertChannels)
      .where(inArray(alertChannels.id, ids as string[]));
  },
  async updateChannel(
    db: Db,
    id: string,
    patch: Partial<NewAlertChannel>,
  ): Promise<AlertChannel | null> {
    const rows = await db
      .update(alertChannels)
      .set(patch)
      .where(eq(alertChannels.id, id))
      .returning();
    return rows[0] ?? null;
  },
  async deleteChannel(db: Db, id: string): Promise<AlertChannel | null> {
    const rows = await db.delete(alertChannels).where(eq(alertChannels.id, id)).returning();
    return rows[0] ?? null;
  },

  // -------- Rules --------
  async createRule(db: Db, input: NewAlertRule): Promise<AlertRule> {
    const rows = await db.insert(alertRules).values(input).returning();
    const r = rows[0];
    if (!r) throw new Error('alertRepo.createRule: insert returned no row');
    return r;
  },
  async getRule(db: Db, id: string): Promise<AlertRule | null> {
    const rows = await db.select().from(alertRules).where(eq(alertRules.id, id)).limit(1);
    return rows[0] ?? null;
  },
  async listRules(db: Db, filters?: RuleListFilters): Promise<AlertRule[]> {
    return db
      .select()
      .from(alertRules)
      .where(ruleWhere(filters))
      .orderBy(asc(alertRules.createdAt));
  },
  async updateRule(db: Db, id: string, patch: Partial<NewAlertRule>): Promise<AlertRule | null> {
    const rows = await db.update(alertRules).set(patch).where(eq(alertRules.id, id)).returning();
    return rows[0] ?? null;
  },
  async deleteRule(db: Db, id: string): Promise<AlertRule | null> {
    const rows = await db.delete(alertRules).where(eq(alertRules.id, id)).returning();
    return rows[0] ?? null;
  },

  // -------- Firings --------
  async createAlert(db: Db, input: NewAlert): Promise<Alert> {
    const rows = await db.insert(alerts).values(input).returning();
    const r = rows[0];
    if (!r) throw new Error('alertRepo.createAlert: insert returned no row');
    return r;
  },
  async getActiveByRule(db: Db, ruleId: string): Promise<Alert | null> {
    const rows = await db
      .select()
      .from(alerts)
      .where(and(eq(alerts.ruleId, ruleId), isNull(alerts.resolvedAt)))
      .orderBy(desc(alerts.firedAt))
      .limit(1);
    return rows[0] ?? null;
  },
  async resolveAlert(db: Db, id: string): Promise<Alert | null> {
    const rows = await db
      .update(alerts)
      .set({ status: 'resolved' satisfies AlertStatus, resolvedAt: new Date() })
      .where(eq(alerts.id, id))
      .returning();
    return rows[0] ?? null;
  },
  async listAlerts(
    db: Db,
    opts: {
      status?: AlertStatus;
      siteId?: string | undefined;
      page?: number;
      limit?: number;
    } = {},
  ): Promise<{ items: Alert[]; page: number; limit: number; total: number }> {
    const page = Math.max(1, opts.page ?? 1);
    const limit = Math.min(100, Math.max(1, opts.limit ?? 20));
    const offset = (page - 1) * limit;
    const clauses: SQL[] = [];
    if (opts.status) clauses.push(eq(alerts.status, opts.status));
    if (opts.siteId) clauses.push(eq(alerts.siteId, opts.siteId));
    const where =
      clauses.length === 0 ? undefined : clauses.length === 1 ? clauses[0] : and(...clauses);
    const items = await db
      .select()
      .from(alerts)
      .where(where)
      .orderBy(desc(alerts.firedAt))
      .limit(limit)
      .offset(offset);
    const totalRow = await db.select({ count: count() }).from(alerts).where(where);
    return { items, page, limit, total: Number(totalRow[0]?.count ?? 0) };
  },
  async getAlert(db: Db, id: string): Promise<Alert | null> {
    const rows = await db.select().from(alerts).where(eq(alerts.id, id)).limit(1);
    return rows[0] ?? null;
  },
  async appendChannelDelivery(
    db: Db,
    id: string,
    delivery: { channel_id: string; sent_at: string; ok: boolean; error?: string },
  ): Promise<void> {
    await db
      .update(alerts)
      .set({
        notifiedChannels: sql`COALESCE(${alerts.notifiedChannels}, '[]'::jsonb) || ${JSON.stringify([delivery])}::jsonb`,
      })
      .where(eq(alerts.id, id));
  },
};
