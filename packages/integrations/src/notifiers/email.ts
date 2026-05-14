/**
 * Email notifier — STUB implementation.
 *
 * MVP doesn't ship real SMTP — we just log the would-be send so operators
 * can see that the channel is wired correctly. A future task can plug a
 * real transport (nodemailer, Resend, etc.) into this same interface.
 */
import type { Notifier } from './types.js';

export type EmailConfig = {
  to: string | string[];
  subjectPrefix?: string;
};

export const emailNotifier: Notifier = async ({ alert, config }) => {
  const cfg = config as EmailConfig;
  if (!cfg.to || (Array.isArray(cfg.to) && cfg.to.length === 0)) {
    return { ok: false, error: 'missing to' };
  }
  const recipients = Array.isArray(cfg.to) ? cfg.to.join(', ') : cfg.to;
  // eslint-disable-next-line no-console
  console.log(
    `[email-stub] would send "${cfg.subjectPrefix ?? '[siteops]'} ${alert.ruleName}" to ${recipients}: ${alert.message}`,
  );
  return { ok: true };
};
