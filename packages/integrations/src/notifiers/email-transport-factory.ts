/**
 * Process-level email transport factory.
 *
 * Reads `EMAIL_PROVIDER` (and provider-specific env) on first call and
 * caches the resulting transport for the life of the process. Tests can
 * inject a fake transport via `__setEmailTransportForTests` and clear it
 * with `__resetEmailTransportForTests` to keep this module pure across
 * suites.
 *
 * The notifier intentionally does NOT pass env through the call chain;
 * channel config (the user-facing `to`, `subjectPrefix`, ...) stays in
 * the alert_channels row, while transport credentials stay in env.
 */
import {
  createDisabledTransport,
  createResendTransport,
  createSmtpTransport,
  type EmailTransport,
} from './email-transport.js';

export type EmailProvider = 'resend' | 'smtp' | 'disabled';

function parseProvider(raw: string | undefined): EmailProvider {
  switch (raw) {
    case 'resend':
    case 'smtp':
    case 'disabled':
      return raw;
    case undefined:
    case '':
      return 'disabled';
    default:
      // Unknown values fall back to disabled; we deliberately don't throw
      // here because env validation lives in the host app's env schema —
      // the integrations package mustn't crash if a test stubs a string.
      return 'disabled';
  }
}

function buildFromEnv(env: NodeJS.ProcessEnv): EmailTransport {
  const provider = parseProvider(env['EMAIL_PROVIDER']);
  if (provider === 'resend') {
    const apiKey = env['RESEND_API_KEY'];
    if (!apiKey) {
      throw new Error('EMAIL_PROVIDER=resend but RESEND_API_KEY is missing');
    }
    return createResendTransport({ apiKey });
  }
  if (provider === 'smtp') {
    const host = env['SMTP_HOST'];
    const portRaw = env['SMTP_PORT'];
    if (!host) throw new Error('EMAIL_PROVIDER=smtp but SMTP_HOST is missing');
    if (!portRaw) throw new Error('EMAIL_PROVIDER=smtp but SMTP_PORT is missing');
    const port = Number(portRaw);
    if (!Number.isFinite(port) || port <= 0) {
      throw new Error(`EMAIL_PROVIDER=smtp but SMTP_PORT="${portRaw}" is invalid`);
    }
    const user = env['SMTP_USER'];
    const pass = env['SMTP_PASS'];
    const tlsRaw = env['SMTP_TLS'];
    return createSmtpTransport({
      host,
      port,
      ...(tlsRaw !== undefined ? { secure: tlsRaw === 'true' } : {}),
      ...(user ? { user } : {}),
      ...(pass ? { pass } : {}),
    });
  }
  return createDisabledTransport();
}

let cached: EmailTransport | undefined;

/**
 * Resolve the active transport. Reads env on first call only; subsequent
 * calls return the cached instance. To pick up env changes (test setups,
 * runtime reconfig) call `__resetEmailTransportForTests` first.
 */
export function getEmailTransport(): EmailTransport {
  if (!cached) {
    cached = buildFromEnv(process.env);
  }
  return cached;
}

/** Resolve the `EMAIL_FROM` address with a sane fallback for dev/stub. */
export function getEmailFrom(): string {
  return process.env['EMAIL_FROM'] ?? 'siteops@example.com';
}

/** Test hook: install a fake transport for the next call to `getEmailTransport`. */
export function __setEmailTransportForTests(transport: EmailTransport): void {
  cached = transport;
}

/** Test hook: clear the cached transport so the next call re-reads env. */
export function __resetEmailTransportForTests(): void {
  cached = undefined;
}
