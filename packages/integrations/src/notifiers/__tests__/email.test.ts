/**
 * Tests for the email notifier — render, escape, transport delegation and
 * error mapping. Transport unit tests live in `email-transport.test.ts`.
 *
 * We exercise the notifier through `createEmailNotifier({ transport })` so
 * the env-driven factory stays untouched across tests.
 */
import { describe, expect, it } from 'vitest';

import {
  buildMessage,
  createEmailNotifier,
  escapeHtml,
  renderHtml,
  renderText,
  type EmailConfig,
} from '../email.js';
import type { EmailMessage, EmailTransport } from '../email-transport.js';
import type { AlertNotification } from '../types.js';

function sampleAlert(overrides: Partial<AlertNotification> = {}): AlertNotification {
  return {
    ruleId: 'rule-1',
    ruleName: 'Uptime <down>',
    status: 'firing',
    metric: 'uptime',
    value: 3,
    message: 'Site is failing checks <script>alert(1)</script>',
    siteId: 'site-1',
    siteName: 'example.com',
    occurredAt: '2026-05-22T02:00:00.000Z',
    source: 'worker:uptime-check',
    ...overrides,
  };
}

function recordingTransport(): EmailTransport & { calls: EmailMessage[] } {
  const calls: EmailMessage[] = [];
  const fn = (async (msg) => {
    calls.push(msg);
  }) as EmailTransport & { calls: EmailMessage[] };
  fn.calls = calls;
  return fn;
}

describe('escapeHtml', () => {
  it('escapes & < > " and \'', () => {
    expect(escapeHtml(`<a href="x">&'</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;',
    );
  });

  it('passes plain text through unchanged', () => {
    expect(escapeHtml('plain text 123')).toBe('plain text 123');
  });
});

describe('renderText / renderHtml', () => {
  it('text body contains rule, metric, value, message and source', () => {
    const text = renderText(sampleAlert());
    expect(text).toContain('[FIRING] Uptime <down>');
    expect(text).toContain('Site: example.com');
    expect(text).toContain('Metric: uptime = 3');
    expect(text).toContain('Site is failing checks <script>alert(1)</script>');
    expect(text).toContain('Source: worker:uptime-check');
  });

  it('html body escapes user-controlled fields', () => {
    const html = renderHtml(sampleAlert());
    expect(html).toContain('Uptime &lt;down&gt;');
    expect(html).toContain('Site is failing checks &lt;script&gt;alert(1)&lt;/script&gt;');
    // Make sure the raw payload didn't sneak through.
    expect(html).not.toContain('<script>alert(1)');
  });

  it('html body omits value row when value is null', () => {
    const html = renderHtml(sampleAlert({ value: null }));
    expect(html).not.toMatch(/<td[^>]*>Value<\/td>/);
  });

  it('uses resolved color for resolved alerts', () => {
    const firing = renderHtml(sampleAlert({ status: 'firing' }));
    const resolved = renderHtml(sampleAlert({ status: 'resolved' }));
    expect(firing).toContain('#dc2626');
    expect(resolved).toContain('#16a34a');
  });
});

describe('buildMessage', () => {
  it('respects subjectPrefix and array `to`', () => {
    const msg = buildMessage(
      sampleAlert({ ruleName: 'My Rule' }),
      { to: ['a@x.com', 'b@x.com'], subjectPrefix: '[ops]' },
      ['a@x.com', 'b@x.com'],
      'noreply@example.com',
    );
    expect(msg.from).toBe('noreply@example.com');
    expect(msg.to).toEqual(['a@x.com', 'b@x.com']);
    expect(msg.subject).toBe('[ops] My Rule');
    expect(msg.html.length).toBeGreaterThan(0);
    expect(msg.text.length).toBeGreaterThan(0);
  });

  it('falls back to the default subject prefix', () => {
    const msg = buildMessage(
      sampleAlert({ ruleName: 'Default' }),
      { to: 'a@x.com' } as EmailConfig,
      ['a@x.com'],
      'from@example.com',
    );
    expect(msg.subject).toBe('[siteops] Default');
  });
});

describe('emailNotifier (via createEmailNotifier)', () => {
  it('returns missing-to when config.to is empty', async () => {
    const notifier = createEmailNotifier({ transport: recordingTransport(), from: 'f@x.com' });
    const result = await notifier({ alert: sampleAlert(), config: { to: [] } });
    expect(result).toEqual({ ok: false, error: 'missing to' });
  });

  it('returns missing-to when config.to is undefined', async () => {
    const notifier = createEmailNotifier({ transport: recordingTransport(), from: 'f@x.com' });
    const result = await notifier({ alert: sampleAlert(), config: {} });
    expect(result).toEqual({ ok: false, error: 'missing to' });
  });

  it('normalises a single string `to` to an array', async () => {
    const transport = recordingTransport();
    const notifier = createEmailNotifier({ transport, from: 'f@x.com' });
    const result = await notifier({
      alert: sampleAlert(),
      config: { to: 'a@x.com' } satisfies EmailConfig,
    });
    expect(result).toEqual({ ok: true });
    expect(transport.calls).toHaveLength(1);
    expect(transport.calls[0]!.to).toEqual(['a@x.com']);
    expect(transport.calls[0]!.from).toBe('f@x.com');
    expect(transport.calls[0]!.subject).toBe('[siteops] Uptime <down>');
    expect(transport.calls[0]!.html).toContain('Uptime &lt;down&gt;');
    expect(transport.calls[0]!.text).toContain('[FIRING] Uptime <down>');
  });

  it('converts transport throws to { ok: false, error }', async () => {
    const failing: EmailTransport = async () => {
      throw new Error('boom');
    };
    const notifier = createEmailNotifier({ transport: failing, from: 'f@x.com' });
    const result = await notifier({
      alert: sampleAlert(),
      config: { to: 'a@x.com' },
    });
    expect(result).toEqual({ ok: false, error: 'boom' });
  });

  it('stringifies non-Error throws', async () => {
    const failing: EmailTransport = async () => {
      throw 'plain-string-failure';
    };
    const notifier = createEmailNotifier({ transport: failing, from: 'f@x.com' });
    const result = await notifier({
      alert: sampleAlert(),
      config: { to: 'a@x.com' },
    });
    expect(result).toEqual({ ok: false, error: 'plain-string-failure' });
  });
});
