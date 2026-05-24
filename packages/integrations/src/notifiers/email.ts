/**
 * Email notifier (T44).
 *
 * Renders an alert into a plain-text + minimal HTML body and hands it to
 * whatever `EmailTransport` the factory resolved from env. Three providers
 * ship out of the box (resend / smtp / disabled); see `email-transport.ts`.
 *
 * Error handling matches the rest of the channel registry: transport
 * exceptions are caught and converted to `{ ok: false, error }` so the
 * dispatcher records the failure and moves on to the next channel without
 * re-firing the whole alert-fire job.
 */
import { getEmailFrom, getEmailTransport } from './email-transport-factory.js';

import type { EmailMessage, EmailTransport } from './email-transport.js';
import type { AlertNotification, Notifier } from './types.js';

export type EmailConfig = {
  /** Recipient(s). Single string or non-empty array. */
  to: string | string[];
  /** Subject prefix; defaults to `[siteops]`. */
  subjectPrefix?: string;
};

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** Minimal HTML escape for user-controlled fields rendered into the email body. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch] ?? ch);
}

function renderText(alert: AlertNotification): string {
  const lines = [
    `[${alert.status.toUpperCase()}] ${alert.ruleName}`,
    `Site: ${alert.siteName ?? alert.siteId ?? 'global'}`,
    `Metric: ${alert.metric}${alert.value === null ? '' : ` = ${alert.value}`}`,
    '',
    alert.message,
    '',
    `At: ${alert.occurredAt}`,
  ];
  if (alert.source) lines.push(`Source: ${alert.source}`);
  return lines.join('\n');
}

function renderHtml(alert: AlertNotification): string {
  const statusColor = alert.status === 'firing' ? '#dc2626' : '#16a34a';
  const valueRow =
    alert.value === null
      ? ''
      : `<tr><td style="padding:4px 8px;color:#6b7280">Value</td><td style="padding:4px 8px"><code>${escapeHtml(String(alert.value))}</code></td></tr>`;
  const sourceRow = alert.source
    ? `<tr><td style="padding:4px 8px;color:#6b7280">Source</td><td style="padding:4px 8px">${escapeHtml(alert.source)}</td></tr>`
    : '';
  return [
    '<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#f9fafb;padding:24px">',
    '<div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:24px">',
    `<div style="display:inline-block;padding:2px 10px;border-radius:9999px;background:${statusColor};color:#fff;font-size:12px;font-weight:600;letter-spacing:0.05em;text-transform:uppercase">${escapeHtml(alert.status)}</div>`,
    `<h1 style="margin:12px 0 4px;font-size:18px;color:#111827">${escapeHtml(alert.ruleName)}</h1>`,
    `<p style="margin:0 0 16px;color:#374151;line-height:1.5">${escapeHtml(alert.message)}</p>`,
    '<table style="border-collapse:collapse;font-size:14px;color:#111827;width:100%">',
    `<tr><td style="padding:4px 8px;color:#6b7280">Site</td><td style="padding:4px 8px">${escapeHtml(alert.siteName ?? alert.siteId ?? 'global')}</td></tr>`,
    `<tr><td style="padding:4px 8px;color:#6b7280">Metric</td><td style="padding:4px 8px"><code>${escapeHtml(alert.metric)}</code></td></tr>`,
    valueRow,
    `<tr><td style="padding:4px 8px;color:#6b7280">At</td><td style="padding:4px 8px">${escapeHtml(alert.occurredAt)}</td></tr>`,
    sourceRow,
    '</table>',
    '<p style="margin:16px 0 0;font-size:12px;color:#9ca3af">SiteOps · automated alert</p>',
    '</div></body></html>',
  ].join('');
}

function buildMessage(
  alert: AlertNotification,
  cfg: EmailConfig,
  to: string[],
  from: string,
): EmailMessage {
  const prefix = cfg.subjectPrefix ?? '[siteops]';
  return {
    from,
    to,
    subject: `${prefix} ${alert.ruleName}`,
    html: renderHtml(alert),
    text: renderText(alert),
  };
}

export type EmailNotifierDeps = {
  /** Override the resolved transport (mainly for tests). */
  transport?: EmailTransport;
  /** Override the resolved `from` address (mainly for tests). */
  from?: string;
};

/**
 * Build an email notifier with a specific transport. Production code uses
 * the exported `emailNotifier` (which resolves the transport from env);
 * tests inject a fake transport via this builder to keep `process.env`
 * untouched.
 */
export function createEmailNotifier(deps: EmailNotifierDeps = {}): Notifier {
  return async ({ alert, config }) => {
    const cfg = config as EmailConfig;
    const to = Array.isArray(cfg.to) ? cfg.to : cfg.to ? [cfg.to] : [];
    if (to.length === 0) return { ok: false, error: 'missing to' };
    const transport = deps.transport ?? getEmailTransport();
    const from = deps.from ?? getEmailFrom();
    const message = buildMessage(alert, cfg, to, from);
    try {
      await transport(message);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  };
}

/**
 * Default notifier instance wired to the env-driven transport. Channel
 * registry uses this; tests should prefer `createEmailNotifier({transport})`.
 */
export const emailNotifier: Notifier = (input) => createEmailNotifier()(input);

// Render helpers exported for tests + future template iteration.
export { renderHtml, renderText, buildMessage };
