/**
 * Alert service.
 *
 * Three responsibilities:
 *   1. CRUD for rules + channels (with config encryption)
 *   2. `fire()` — given a metric observation, evaluate matching rules and
 *      produce alert rows + dispatch notifications
 *   3. `resolve()` — clear `firing` alerts when a metric recovers
 */
import {
  alertRepo,
  type Alert,
  type AlertChannel,
  type AlertMetric,
  type AlertRule,
  type Db,
  type NewAlertChannel,
  type NewAlertRule,
} from '@siteops/db';
import { notifiers as notifiersNs } from '@siteops/integrations';
import {
  AppError,
  type CreateAlertChannelInput,
  type CreateAlertRuleInput,
  type Logger,
  type UpdateAlertChannelInput,
  type UpdateAlertRuleInput,
} from '@siteops/shared';

import type { AlertCipher } from './cipher.js';
import { evaluate, type MetricInput } from './evaluator.js';

export type AlertServiceDeps = {
  db: Db;
  cipher: AlertCipher;
  logger?: Pick<Logger, 'info' | 'warn' | 'error'>;
};

export type FireInput = {
  /** Optional site scope. Global rules ignore this. */
  siteId: string | null;
  siteName?: string;
  source?: string;
  /** Metric observation. */
  observation: MetricInput;
  /** Override the timestamp (mostly for tests). */
  now?: Date;
};

export type FireOutput = {
  triggered: Array<{ rule: AlertRule; alert: Alert }>;
  resolved: Array<{ rule: AlertRule; alert: Alert }>;
};

function publicChannel(
  channel: AlertChannel,
  decryptedConfig: Record<string, unknown>,
): AlertChannel & { config: Record<string, unknown> } {
  return { ...channel, config: decryptedConfig };
}

export const alertService = {
  // ---------------- Channels ----------------
  async createChannel(
    deps: AlertServiceDeps,
    input: CreateAlertChannelInput,
  ): Promise<AlertChannel> {
    const enc = deps.cipher.encryptObject(input.config);
    const insert: NewAlertChannel = {
      name: input.name,
      type: input.type,
      enabled: input.enabled,
      config: { _enc: enc },
    };
    const row = await alertRepo.createChannel(deps.db, insert);
    deps.logger?.info(
      { event: 'alert.channel_created', id: row.id, type: row.type },
      'channel created',
    );
    return row;
  },

  async updateChannel(
    deps: AlertServiceDeps,
    id: string,
    patch: UpdateAlertChannelInput,
  ): Promise<AlertChannel> {
    const next: Partial<NewAlertChannel> = {};
    if (patch.name !== undefined) next.name = patch.name;
    if (patch.type !== undefined) next.type = patch.type;
    if (patch.enabled !== undefined) next.enabled = patch.enabled;
    if (patch.config !== undefined) {
      next.config = { _enc: deps.cipher.encryptObject(patch.config) };
    }
    const row = await alertRepo.updateChannel(deps.db, id, next);
    if (!row) throw new AppError('Channel not found', { code: 'not_found', status: 404 });
    return row;
  },

  async deleteChannel(deps: AlertServiceDeps, id: string): Promise<AlertChannel> {
    const row = await alertRepo.deleteChannel(deps.db, id);
    if (!row) throw new AppError('Channel not found', { code: 'not_found', status: 404 });
    return row;
  },

  async listChannels(deps: AlertServiceDeps): Promise<AlertChannel[]> {
    return alertRepo.listChannels(deps.db);
  },

  async getChannelWithConfig(
    deps: AlertServiceDeps,
    id: string,
  ): Promise<AlertChannel & { config: Record<string, unknown> }> {
    const row = await alertRepo.getChannel(deps.db, id);
    if (!row) throw new AppError('Channel not found', { code: 'not_found', status: 404 });
    const enc = (row.config as { _enc?: string })._enc;
    const cfg = enc
      ? deps.cipher.decryptObject<Record<string, unknown>>(enc)
      : (row.config as Record<string, unknown>);
    return publicChannel(row, cfg);
  },

  // ---------------- Rules ----------------
  async createRule(deps: AlertServiceDeps, input: CreateAlertRuleInput): Promise<AlertRule> {
    const insert: NewAlertRule = {
      name: input.name,
      scope: input.scope,
      ...(input.siteId ? { siteId: input.siteId } : {}),
      metric: input.metric,
      operator: input.operator,
      threshold: input.threshold.toString(),
      ...(input.windowMinutes !== undefined ? { windowMinutes: input.windowMinutes } : {}),
      consecutive: input.consecutive,
      enabled: input.enabled,
      channelIds: input.channelIds,
    };
    const row = await alertRepo.createRule(deps.db, insert);
    deps.logger?.info(
      { event: 'alert.rule_created', id: row.id, metric: row.metric },
      'rule created',
    );
    return row;
  },

  async updateRule(
    deps: AlertServiceDeps,
    id: string,
    patch: UpdateAlertRuleInput,
  ): Promise<AlertRule> {
    const dbPatch: Partial<NewAlertRule> = {};
    if (patch.name !== undefined) dbPatch.name = patch.name;
    if (patch.metric !== undefined) dbPatch.metric = patch.metric;
    if (patch.operator !== undefined) dbPatch.operator = patch.operator;
    if (patch.threshold !== undefined) dbPatch.threshold = patch.threshold.toString();
    if (patch.windowMinutes !== undefined) dbPatch.windowMinutes = patch.windowMinutes;
    if (patch.consecutive !== undefined) dbPatch.consecutive = patch.consecutive;
    if (patch.enabled !== undefined) dbPatch.enabled = patch.enabled;
    if (patch.channelIds !== undefined) dbPatch.channelIds = patch.channelIds;
    const row = await alertRepo.updateRule(deps.db, id, dbPatch);
    if (!row) throw new AppError('Rule not found', { code: 'not_found', status: 404 });
    return row;
  },

  async deleteRule(deps: AlertServiceDeps, id: string): Promise<AlertRule> {
    const row = await alertRepo.deleteRule(deps.db, id);
    if (!row) throw new AppError('Rule not found', { code: 'not_found', status: 404 });
    return row;
  },

  async listRules(deps: AlertServiceDeps): Promise<AlertRule[]> {
    return alertRepo.listRules(deps.db);
  },

  async getRule(deps: AlertServiceDeps, id: string): Promise<AlertRule> {
    const row = await alertRepo.getRule(deps.db, id);
    if (!row) throw new AppError('Rule not found', { code: 'not_found', status: 404 });
    return row;
  },

  // ---------------- Firings ----------------
  /**
   * Given a metric observation, evaluate all matching rules and create
   * alert rows for the ones that fire. Already-firing alerts are NOT
   * duplicated; instead we append to `notifiedChannels` so dashboards
   * can render the most recent attempt.
   */
  async fire(deps: AlertServiceDeps, input: FireInput): Promise<FireOutput> {
    const now = input.now ?? new Date();
    const rules = (await alertRepo.listRules(deps.db, { enabled: true })).filter((r: AlertRule) => {
      if (r.metric !== (input.observation.metric as AlertMetric)) return false;
      if (r.scope === 'site' && r.siteId !== input.siteId) return false;
      return true;
    });
    const triggered: FireOutput['triggered'] = [];
    const resolved: FireOutput['resolved'] = [];

    for (const rule of rules) {
      const verdict = evaluate(rule, input.observation);
      const active = await alertRepo.getActiveByRule(deps.db, rule.id);
      if (verdict.fires) {
        if (active) {
          // Already firing — append fresh delivery records but don't dup the row.
          await this.dispatchNotifications(
            deps,
            rule,
            active,
            verdict.value,
            verdict.message,
            input,
          );
          triggered.push({ rule, alert: active });
        } else {
          const alert = await alertRepo.createAlert(deps.db, {
            ruleId: rule.id,
            siteId: input.siteId,
            status: 'firing',
            value: verdict.value.toString(),
            message: verdict.message,
            firedAt: now,
          });
          await this.dispatchNotifications(
            deps,
            rule,
            alert,
            verdict.value,
            verdict.message,
            input,
          );
          triggered.push({ rule, alert });
        }
      } else if (active) {
        const closed = await alertRepo.resolveAlert(deps.db, active.id);
        if (closed) {
          await this.dispatchNotifications(
            deps,
            rule,
            closed,
            verdict.fires ? 1 : 0,
            'Recovered',
            input,
            'resolved',
          );
          resolved.push({ rule, alert: closed });
        }
      }
    }
    return { triggered, resolved };
  },

  /** Internal — fan out to every channel attached to the rule. */
  async dispatchNotifications(
    deps: AlertServiceDeps,
    rule: AlertRule,
    alert: Alert,
    value: number,
    message: string,
    input: FireInput,
    status: 'firing' | 'resolved' = 'firing',
  ): Promise<void> {
    if (rule.channelIds.length === 0) return;
    const channels = await alertRepo.listChannelsByIds(deps.db, rule.channelIds);
    const now = (input.now ?? new Date()).toISOString();
    const notification = {
      ruleId: rule.id,
      ruleName: rule.name,
      status,
      metric: rule.metric,
      value,
      message,
      siteId: input.siteId,
      ...(input.siteName ? { siteName: input.siteName } : {}),
      occurredAt: now,
      ...(input.source ? { source: input.source } : {}),
    };
    for (const channel of channels) {
      if (!channel.enabled) continue;
      const enc = (channel.config as { _enc?: string })._enc;
      const cfg = enc
        ? deps.cipher.decryptObject<Record<string, unknown>>(enc)
        : (channel.config as Record<string, unknown>);
      const result = await notifiersNs.notify(
        channel.type as notifiersNs.ChannelType,
        notification,
        cfg,
      );
      await alertRepo.appendChannelDelivery(deps.db, alert.id, {
        channel_id: channel.id,
        sent_at: new Date().toISOString(),
        ok: result.ok,
        ...(result.ok ? {} : { error: result.error }),
      });
      deps.logger?.info(
        {
          event: 'alert.notify',
          alertId: alert.id,
          channelId: channel.id,
          channelType: channel.type,
          ok: result.ok,
          error: result.ok ? undefined : result.error,
        },
        'alert notified',
      );
    }
  },

  async testChannel(
    deps: AlertServiceDeps,
    id: string,
    message: string,
  ): Promise<{ ok: boolean; error?: string }> {
    const channel = await this.getChannelWithConfig(deps, id);
    const result = await notifiersNs.notify(
      channel.type as notifiersNs.ChannelType,
      {
        ruleId: 'test',
        ruleName: `Test from ${channel.name}`,
        status: 'firing',
        metric: 'custom',
        value: 1,
        message,
        siteId: null,
        occurredAt: new Date().toISOString(),
        source: 'channel-test',
      },
      channel.config,
    );
    return result.ok ? { ok: true } : { ok: false, error: result.error };
  },

  async listAlerts(
    deps: AlertServiceDeps,
    opts: Parameters<typeof alertRepo.listAlerts>[1] = {},
  ): Promise<ReturnType<typeof alertRepo.listAlerts>> {
    return alertRepo.listAlerts(deps.db, opts);
  },
};
