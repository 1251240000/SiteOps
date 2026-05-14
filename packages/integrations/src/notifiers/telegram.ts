/** Telegram bot notifier. */
import { httpFetch } from '../http/http-client.js';

import type { AlertNotification, Notifier } from './types.js';

export type TelegramConfig = { botToken: string; chatId: string };

function buildText(a: AlertNotification): string {
  return [
    `${a.status === 'firing' ? '🚨' : '✅'} ${a.ruleName} (${a.status})`,
    `Site: ${a.siteName ?? a.siteId ?? 'global'}`,
    `Metric: ${a.metric}${a.value === null ? '' : ` = ${a.value}`}`,
    a.message,
    `At: ${a.occurredAt}`,
  ].join('\n');
}

export const telegramNotifier: Notifier = async ({ alert, config }) => {
  const cfg = config as TelegramConfig;
  if (!cfg.botToken || !cfg.chatId) {
    return { ok: false, error: 'missing botToken or chatId' };
  }
  const url = `https://api.telegram.org/bot${cfg.botToken}/sendMessage`;
  const payload = { chat_id: cfg.chatId, text: buildText(alert) };
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
    return { ok: false, error: `telegram returned ${res.status}: ${res.body.slice(0, 200)}` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
};
