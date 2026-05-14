/**
 * Alert engine enums. Mirrored in `@siteops/db` schema; drift is guarded
 * by the db package's `constants-drift.test.ts`.
 */

export const ALERT_SCOPES = ['global', 'site'] as const;
export type AlertScope = (typeof ALERT_SCOPES)[number];

export const ALERT_METRICS = [
  'uptime',
  'ssl_expiry',
  'domain_expiry',
  'lighthouse_perf',
  'error_rate',
  'custom',
] as const;
export type AlertMetric = (typeof ALERT_METRICS)[number];

export const ALERT_OPERATORS = ['lt', 'lte', 'gt', 'gte', 'eq'] as const;
export type AlertOperator = (typeof ALERT_OPERATORS)[number];

export const ALERT_CHANNEL_TYPES = [
  'webhook',
  'email',
  'feishu',
  'dingtalk',
  'slack',
  'telegram',
] as const;
export type AlertChannelType = (typeof ALERT_CHANNEL_TYPES)[number];

export const ALERT_STATUS = ['firing', 'resolved'] as const;
export type AlertStatus = (typeof ALERT_STATUS)[number];
