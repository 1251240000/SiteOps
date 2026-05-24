/**
 * Transport-level tests for T44.
 *
 *  - `createResendTransport` is exercised through an injected fetch so we
 *    can assert the exact HTTP shape (URL, headers, JSON body) without
 *    touching the network.
 *  - `createSmtpTransport` is exercised through an injected nodemailer
 *    factory, so the optional `nodemailer` dependency doesn't have to be
 *    installed for tests to pass.
 *  - `createDisabledTransport` uses a captured log sink instead of the
 *    default `console.log`.
 *  - The env-driven factory is verified end-to-end via the public test
 *    hooks (`__setEmailTransportForTests` / `__resetEmailTransportForTests`).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createDisabledTransport,
  createResendTransport,
  createSmtpTransport,
  type EmailMessage,
  type NodemailerCreateTransport,
  type ResendFetch,
} from '../email-transport.js';
import {
  __resetEmailTransportForTests,
  __setEmailTransportForTests,
  getEmailFrom,
  getEmailTransport,
} from '../email-transport-factory.js';

function sampleMessage(overrides: Partial<EmailMessage> = {}): EmailMessage {
  return {
    from: 'noreply@example.com',
    to: ['ops@example.com'],
    subject: '[siteops] Uptime',
    html: '<p>hi</p>',
    text: 'hi',
    ...overrides,
  };
}

describe('createResendTransport', () => {
  it('POSTs to the configured endpoint with auth + JSON body', async () => {
    const calls: Array<{
      url: string;
      method: string;
      headers: Record<string, string>;
      body: string;
    }> = [];
    const fetchImpl: ResendFetch = async (url, init) => {
      calls.push({ url, method: init.method, headers: init.headers, body: init.body });
      return { status: 202, body: '{"id":"msg_1"}' };
    };
    const transport = createResendTransport({ apiKey: 're_test', fetchImpl });
    await transport(sampleMessage({ subject: 'hello' }));
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://api.resend.com/emails');
    expect(calls[0]!.method).toBe('POST');
    expect(calls[0]!.headers).toMatchObject({
      authorization: 'Bearer re_test',
      'content-type': 'application/json',
    });
    const body = JSON.parse(calls[0]!.body) as Record<string, unknown>;
    expect(body).toEqual({
      from: 'noreply@example.com',
      to: ['ops@example.com'],
      subject: 'hello',
      html: '<p>hi</p>',
      text: 'hi',
    });
  });

  it('honours endpoint override', async () => {
    let captured = '';
    const fetchImpl: ResendFetch = async (url) => {
      captured = url;
      return { status: 200, body: '' };
    };
    const transport = createResendTransport({
      apiKey: 'x',
      endpoint: 'https://example.test/emails',
      fetchImpl,
    });
    await transport(sampleMessage());
    expect(captured).toBe('https://example.test/emails');
  });

  it('throws on non-2xx with status + body excerpt', async () => {
    const fetchImpl: ResendFetch = async () => ({
      status: 422,
      body: '{"name":"validation_error","message":"missing from"}',
    });
    const transport = createResendTransport({ apiKey: 'k', fetchImpl });
    await expect(transport(sampleMessage())).rejects.toThrow(/resend 422:.*missing from/);
  });

  it('rejects empty apiKey at construction', () => {
    expect(() => createResendTransport({ apiKey: '' })).toThrow(/apiKey is required/);
  });
});

describe('createSmtpTransport', () => {
  it('lazily builds the transporter and forwards the message', async () => {
    const sendMail = async (): Promise<unknown> => ({ messageId: '<1>' });
    const sendCalls: Array<Record<string, unknown>> = [];
    const wrappedSendMail = async (opts: Record<string, unknown>): Promise<unknown> => {
      sendCalls.push(opts);
      return sendMail();
    };
    let createTransportArgs: unknown;
    const fakeCreateTransport: NodemailerCreateTransport = (opts) => {
      createTransportArgs = opts;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return { sendMail: wrappedSendMail as any };
    };
    const transport = createSmtpTransport(
      { host: 'smtp.example.com', port: 587, user: 'u', pass: 'p' },
      async () => fakeCreateTransport,
    );
    await transport(sampleMessage({ to: ['a@x.com', 'b@x.com'] }));
    await transport(sampleMessage());
    expect(createTransportArgs).toEqual({
      host: 'smtp.example.com',
      port: 587,
      secure: false,
      auth: { user: 'u', pass: 'p' },
    });
    // Two sends but the transporter is built only once.
    expect(sendCalls).toHaveLength(2);
    expect(sendCalls[0]).toMatchObject({
      from: 'noreply@example.com',
      to: 'a@x.com, b@x.com',
      subject: '[siteops] Uptime',
      text: 'hi',
    });
  });

  it('infers implicit-TLS from port 465 when secure is unset', async () => {
    let captured: { secure?: boolean } = {};
    const fakeCreateTransport: NodemailerCreateTransport = (opts) => {
      captured = opts;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return { sendMail: (async () => undefined) as any };
    };
    const transport = createSmtpTransport(
      { host: 'h', port: 465 },
      async () => fakeCreateTransport,
    );
    await transport(sampleMessage());
    expect(captured.secure).toBe(true);
  });

  it('rejects missing host / port', () => {
    expect(() => createSmtpTransport({ host: '', port: 587 })).toThrow(/host is required/);
    expect(() => createSmtpTransport({ host: 'h', port: 0 })).toThrow(/port is required/);
  });

  it('surfaces a friendly error when nodemailer is not installed', async () => {
    const transport = createSmtpTransport({ host: 'h', port: 25 }, async () => {
      throw new Error('module-not-found');
    });
    await expect(transport(sampleMessage())).rejects.toThrow();
  });
});

describe('createDisabledTransport', () => {
  it('writes a single log line and resolves', async () => {
    const lines: string[] = [];
    const transport = createDisabledTransport({ log: (l) => lines.push(l) });
    await transport(sampleMessage({ subject: 'hi', to: ['a@x.com', 'b@x.com'] }));
    expect(lines).toEqual(['[email-disabled] would send "hi" to a@x.com, b@x.com']);
  });
});

describe('email-transport-factory (env-driven)', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    __resetEmailTransportForTests();
  });

  afterEach(() => {
    for (const key of [
      'EMAIL_PROVIDER',
      'EMAIL_FROM',
      'RESEND_API_KEY',
      'SMTP_HOST',
      'SMTP_PORT',
      'SMTP_USER',
      'SMTP_PASS',
      'SMTP_TLS',
    ]) {
      delete process.env[key];
    }
    for (const [k, v] of Object.entries(originalEnv)) {
      if (v !== undefined) process.env[k] = v;
    }
    __resetEmailTransportForTests();
  });

  it('defaults to the disabled transport when EMAIL_PROVIDER is unset', async () => {
    delete process.env['EMAIL_PROVIDER'];
    delete process.env['RESEND_API_KEY'];
    // Silence the disabled-transport console.log during the assertion.
    const silent = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      const transport = getEmailTransport();
      await expect(transport(sampleMessage())).resolves.toBeUndefined();
    } finally {
      silent.mockRestore();
    }
  });

  it('errors when EMAIL_PROVIDER=resend but RESEND_API_KEY is missing', () => {
    process.env['EMAIL_PROVIDER'] = 'resend';
    delete process.env['RESEND_API_KEY'];
    expect(() => getEmailTransport()).toThrow(/RESEND_API_KEY is missing/);
  });

  it('errors when EMAIL_PROVIDER=smtp but SMTP_HOST is missing', () => {
    process.env['EMAIL_PROVIDER'] = 'smtp';
    delete process.env['SMTP_HOST'];
    process.env['SMTP_PORT'] = '587';
    expect(() => getEmailTransport()).toThrow(/SMTP_HOST is missing/);
  });

  it('falls back to disabled on an unknown provider value', async () => {
    process.env['EMAIL_PROVIDER'] = 'mailgun';
    const silent = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      const transport = getEmailTransport();
      await expect(transport(sampleMessage())).resolves.toBeUndefined();
    } finally {
      silent.mockRestore();
    }
  });

  it('caches the resolved transport across calls', () => {
    process.env['EMAIL_PROVIDER'] = 'disabled';
    const a = getEmailTransport();
    const b = getEmailTransport();
    expect(a).toBe(b);
  });

  it('__setEmailTransportForTests installs a fake transport', async () => {
    const calls: EmailMessage[] = [];
    __setEmailTransportForTests(async (msg) => {
      calls.push(msg);
    });
    const t = getEmailTransport();
    await t(sampleMessage());
    expect(calls).toHaveLength(1);
  });

  it('getEmailFrom respects EMAIL_FROM and falls back', () => {
    delete process.env['EMAIL_FROM'];
    expect(getEmailFrom()).toBe('siteops@example.com');
    process.env['EMAIL_FROM'] = 'noreply@example.test';
    expect(getEmailFrom()).toBe('noreply@example.test');
  });
});
