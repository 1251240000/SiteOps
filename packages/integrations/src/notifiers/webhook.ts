/** Generic webhook notifier. POSTs the alert payload as JSON. */
import { httpFetch } from '../http/http-client.js';

import type { Notifier } from './types.js';

export type WebhookConfig = {
  url: string;
  /** Optional extra headers. */
  headers?: Record<string, string>;
};

export const webhookNotifier: Notifier = async ({ alert, config }) => {
  const cfg = config as WebhookConfig;
  if (!cfg.url) return { ok: false, error: 'missing url' };
  try {
    const res = await httpFetch(cfg.url, {
      method: 'POST',
      body: JSON.stringify(alert),
      headers: {
        'content-type': 'application/json',
        ...(cfg.headers ?? {}),
      },
      timeoutMs: 10_000,
      maxBytes: 16 * 1024,
      followRedirects: false,
    });
    if (res.status >= 200 && res.status < 300) return { ok: true };
    return { ok: false, error: `webhook returned ${res.status}` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
};
