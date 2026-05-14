/** Slack incoming-webhook notifier. */
import { httpFetch } from '../http/http-client.js';

import type { AlertNotification, Notifier } from './types.js';

export type SlackConfig = { webhookUrl: string };

function buildText(a: AlertNotification): string {
  const emoji = a.status === 'firing' ? ':rotating_light:' : ':white_check_mark:';
  return [
    `${emoji} *${a.ruleName}* — ${a.status.toUpperCase()}`,
    `> Site: ${a.siteName ?? a.siteId ?? 'global'}`,
    `> Metric: \`${a.metric}\`${a.value === null ? '' : ` = \`${a.value}\``}`,
    `> ${a.message}`,
    `> _${a.occurredAt}_`,
  ].join('\n');
}

export const slackNotifier: Notifier = async ({ alert, config }) => {
  const cfg = config as SlackConfig;
  if (!cfg.webhookUrl) return { ok: false, error: 'missing webhookUrl' };
  try {
    const res = await httpFetch(cfg.webhookUrl, {
      method: 'POST',
      body: JSON.stringify({ text: buildText(alert) }),
      headers: { 'content-type': 'application/json' },
      timeoutMs: 10_000,
      maxBytes: 16 * 1024,
      followRedirects: false,
    });
    if (res.status >= 200 && res.status < 300) return { ok: true };
    return { ok: false, error: `slack returned ${res.status}: ${res.body.slice(0, 200)}` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
};
