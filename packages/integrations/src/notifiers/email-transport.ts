/**
 * Email transport layer.
 *
 * A transport is the thin "actually push bytes" boundary between the
 * `emailNotifier` (which knows about alerts) and an outbound provider
 * (Resend / SMTP / no-op). Keeping the boundary intentionally narrow
 * makes the notifier trivial to unit-test (inject a fake transport) and
 * lets us add new providers without touching alert rendering.
 *
 * Design notes:
 *  - Transports throw on failure. The notifier catches and converts to
 *    `{ ok: false, error }` to stay consistent with every other channel
 *    (slack/feishu/...) — fan-out resilience lives in the dispatcher,
 *    we don't want one bad email to retry the whole alert-fire job and
 *    re-fire IM channels.
 *  - `nodemailer` is an optional dependency loaded via dynamic import so
 *    Resend / disabled deployments don't pull it into the web bundle.
 */
import { httpFetch } from '../http/http-client.js';

export type EmailMessage = {
  from: string;
  to: string[];
  subject: string;
  html: string;
  text: string;
};

export type EmailTransport = (msg: EmailMessage) => Promise<void>;

// ---------------- Resend ----------------

/** Fetch shape compatible with both `httpFetch` (default) and test injection. */
export type ResendFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ status: number; body: string }>;

const defaultResendFetch: ResendFetch = async (url, init) => {
  const res = await httpFetch(url, {
    method: init.method,
    headers: init.headers,
    body: init.body,
    timeoutMs: 10_000,
    maxBytes: 16 * 1024,
    followRedirects: false,
  });
  return { status: res.status, body: res.body };
};

export type ResendTransportOptions = {
  apiKey: string;
  /** Override endpoint (defaults to `https://api.resend.com/emails`). */
  endpoint?: string;
  /** Test-only fetch override. Production callers should leave undefined. */
  fetchImpl?: ResendFetch;
};

export function createResendTransport(opts: ResendTransportOptions): EmailTransport {
  if (!opts.apiKey) {
    throw new Error('resend: apiKey is required');
  }
  const endpoint = opts.endpoint ?? 'https://api.resend.com/emails';
  const fetchImpl = opts.fetchImpl ?? defaultResendFetch;
  return async (msg) => {
    const res = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${opts.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from: msg.from,
        to: msg.to,
        subject: msg.subject,
        html: msg.html,
        text: msg.text,
      }),
    });
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`resend ${res.status}: ${res.body.slice(0, 200)}`);
    }
  };
}

// ---------------- SMTP (nodemailer) ----------------

export type SmtpTransportOptions = {
  host: string;
  port: number;
  /** TLS mode. `true` enables implicit TLS (port 465); `false` lets nodemailer STARTTLS-upgrade if available. */
  secure?: boolean;
  user?: string;
  pass?: string;
};

/**
 * Minimal subset of nodemailer's `Transporter` we rely on. Declared inline
 * so we don't force consumers to install `@types/nodemailer` to typecheck.
 */
type NodemailerTransporter = {
  sendMail(opts: {
    from: string;
    to: string;
    subject: string;
    html: string;
    text: string;
  }): Promise<unknown>;
};

export type NodemailerCreateTransport = (opts: {
  host: string;
  port: number;
  secure: boolean;
  auth?: { user: string; pass: string };
}) => NodemailerTransporter;

/**
 * Default factory: dynamic-imports `nodemailer` only when SMTP is actually
 * used, so non-SMTP deployments don't pay the bundle / install cost.
 *
 * The module path goes through a string variable so TypeScript can't resolve
 * it statically; that lets `pnpm typecheck` succeed in environments where
 * the optional `nodemailer` dependency hasn't been installed (e.g. CI runs
 * with `pnpm install --no-optional`). Same pattern as `lighthouse/real-runner`.
 */
async function defaultNodemailerFactory(): Promise<NodemailerCreateTransport> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dynImport = (s: string): Promise<any> => import(/* @vite-ignore */ s);
  let mod: {
    createTransport?: NodemailerCreateTransport;
    default?: { createTransport?: NodemailerCreateTransport };
  };
  try {
    mod = await dynImport('nodemailer');
  } catch (err) {
    throw new Error(
      `EMAIL_PROVIDER=smtp requires the optional dependency 'nodemailer'. Install it (or rebuild the image with the optional deps enabled): ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
  const createTransport = mod.createTransport ?? mod.default?.createTransport;
  if (typeof createTransport !== 'function') {
    throw new Error('nodemailer: createTransport not found on imported module');
  }
  return createTransport;
}

export function createSmtpTransport(
  opts: SmtpTransportOptions,
  factory: () => Promise<NodemailerCreateTransport> = defaultNodemailerFactory,
): EmailTransport {
  if (!opts.host) throw new Error('smtp: host is required');
  if (!opts.port) throw new Error('smtp: port is required');
  let transporter: NodemailerTransporter | undefined;

  return async (msg) => {
    if (!transporter) {
      const createTransport = await factory();
      const auth = opts.user && opts.pass ? { user: opts.user, pass: opts.pass } : undefined;
      transporter = createTransport({
        host: opts.host,
        port: opts.port,
        secure: opts.secure ?? opts.port === 465,
        ...(auth ? { auth } : {}),
      });
    }
    await transporter.sendMail({
      from: msg.from,
      to: msg.to.join(', '),
      subject: msg.subject,
      html: msg.html,
      text: msg.text,
    });
  };
}

// ---------------- Disabled (log only) ----------------

export type DisabledTransportOptions = {
  /** Override the log sink (defaults to `console.log`). */
  log?: (line: string) => void;
};

export function createDisabledTransport(opts: DisabledTransportOptions = {}): EmailTransport {
  // eslint-disable-next-line no-console
  const log = opts.log ?? ((line: string) => console.log(line));
  return async (msg) => {
    log(`[email-disabled] would send "${msg.subject}" to ${msg.to.join(', ')}`);
  };
}
