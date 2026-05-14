/** Shared notifier contract. */
export type AlertNotification = {
  ruleId: string;
  ruleName: string;
  status: 'firing' | 'resolved';
  metric: string;
  value: number | null;
  message: string;
  siteId?: string | null;
  /** Optional human-readable site name; falls back to siteId. */
  siteName?: string;
  /** ISO timestamp. */
  occurredAt: string;
  /** Where the alert was raised from (e.g. `worker:uptime-check`). */
  source?: string;
};

export type NotifyResult = { ok: true } | { ok: false; error: string };

export type Notifier = (input: {
  alert: AlertNotification;
  config: Record<string, unknown>;
}) => Promise<NotifyResult>;
