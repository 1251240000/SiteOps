/** Feishu (Lark) custom bot notifier. */
import { httpFetch } from '../http/http-client.js';

import type { AlertNotification, Notifier } from './types.js';

export type FeishuConfig = {
  webhookUrl: string;
  /** Optional secret for signature mode. */
  secret?: string;
};

function buildContent(a: AlertNotification): string {
  const lines = [
    `${a.status === 'firing' ? '🚨' : '✅'} [${a.ruleName}] ${a.status.toUpperCase()}`,
    `Site: ${a.siteName ?? a.siteId ?? 'global'}`,
    `Metric: ${a.metric}${a.value === null ? '' : ` = ${a.value}`}`,
    a.message,
    `At: ${a.occurredAt}`,
  ];
  return lines.join('\n');
}

export const feishuNotifier: Notifier = async ({ alert, config }) => {
  const cfg = config as FeishuConfig;
  if (!cfg.webhookUrl) return { ok: false, error: 'missing webhookUrl' };
  const payload: Record<string, unknown> = {
    msg_type: 'text',
    content: { text: buildContent(alert) },
  };
  if (cfg.secret) {
    // Feishu sign mode: ts + '\n' + secret HMAC-SHA256 → base64
    const ts = Math.floor(Date.now() / 1000);
    const { createHmac } = await import('node:crypto');
    const sign = createHmac('sha256', `${ts}\n${cfg.secret}`).update('').digest('base64');
    (payload as Record<string, unknown>)['timestamp'] = ts.toString();
    (payload as Record<string, unknown>)['sign'] = sign;
  }
  try {
    const res = await httpFetch(cfg.webhookUrl, {
      method: 'POST',
      body: JSON.stringify(payload),
      headers: { 'content-type': 'application/json' },
      timeoutMs: 10_000,
      maxBytes: 16 * 1024,
      followRedirects: false,
    });
    if (res.status >= 200 && res.status < 300) return { ok: true };
    return { ok: false, error: `feishu returned ${res.status}: ${res.body.slice(0, 200)}` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
};
