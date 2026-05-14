/** DingTalk custom bot notifier with optional signature. */
import { httpFetch } from '../http/http-client.js';

import type { AlertNotification, Notifier } from './types.js';

export type DingtalkConfig = {
  webhookUrl: string;
  /** Optional signing secret. */
  secret?: string;
};

function buildText(a: AlertNotification): string {
  return [
    `${a.status === 'firing' ? '[ALERT]' : '[RESOLVED]'} ${a.ruleName}`,
    `Site: ${a.siteName ?? a.siteId ?? 'global'}`,
    `Metric: ${a.metric}${a.value === null ? '' : ` = ${a.value}`}`,
    a.message,
    `At: ${a.occurredAt}`,
  ].join('\n');
}

async function signedUrl(url: string, secret: string): Promise<string> {
  const ts = Date.now();
  const { createHmac } = await import('node:crypto');
  const stringToSign = `${ts}\n${secret}`;
  const sign = createHmac('sha256', secret).update(stringToSign).digest('base64');
  const u = new URL(url);
  u.searchParams.set('timestamp', String(ts));
  u.searchParams.set('sign', sign);
  return u.toString();
}

export const dingtalkNotifier: Notifier = async ({ alert, config }) => {
  const cfg = config as DingtalkConfig;
  if (!cfg.webhookUrl) return { ok: false, error: 'missing webhookUrl' };
  const url = cfg.secret ? await signedUrl(cfg.webhookUrl, cfg.secret) : cfg.webhookUrl;
  const payload = {
    msgtype: 'text',
    text: { content: buildText(alert) },
  };
  try {
    const res = await httpFetch(url, {
      method: 'POST',
      body: JSON.stringify(payload),
      headers: { 'content-type': 'application/json' },
      timeoutMs: 10_000,
      maxBytes: 16 * 1024,
      followRedirects: false,
    });
    if (res.status >= 200 && res.status < 300) return { ok: true };
    return { ok: false, error: `dingtalk returned ${res.status}: ${res.body.slice(0, 200)}` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
};
