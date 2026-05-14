import { describe, expect, it } from 'vitest';

import type { AlertRule } from '@siteops/db';

import { evaluate } from '../evaluator.js';

function rule(overrides: Partial<AlertRule> & Pick<AlertRule, 'metric' | 'operator'>): AlertRule {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    name: 'test',
    scope: 'global',
    siteId: null,
    threshold: '3' as unknown as AlertRule['threshold'],
    windowMinutes: null,
    consecutive: 1,
    enabled: true,
    channelIds: [],
    createdAt: new Date(),
    ...overrides,
  } as AlertRule;
}

describe('evaluate', () => {
  it('uptime fires when consecutiveFailures >= threshold (gte)', () => {
    const r = rule({ metric: 'uptime', operator: 'gte', threshold: '3' as never });
    const out = evaluate(r, { metric: 'uptime', consecutiveFailures: 4 });
    expect(out.fires).toBe(true);
  });

  it('uptime does not fire below threshold', () => {
    const r = rule({ metric: 'uptime', operator: 'gte', threshold: '3' as never });
    const out = evaluate(r, { metric: 'uptime', consecutiveFailures: 2 });
    expect(out.fires).toBe(false);
  });

  it('ssl_expiry fires when daysRemaining < threshold', () => {
    const r = rule({ metric: 'ssl_expiry', operator: 'lt', threshold: '14' as never });
    const out = evaluate(r, { metric: 'ssl_expiry', daysRemaining: 7 });
    expect(out.fires).toBe(true);
  });

  it('lighthouse_perf fires when score <= threshold', () => {
    const r = rule({ metric: 'lighthouse_perf', operator: 'lte', threshold: '0.3' as never });
    const out = evaluate(r, { metric: 'lighthouse_perf', score: 0.25 });
    expect(out.fires).toBe(true);
  });

  it('disabled rules never fire', () => {
    const r = rule({
      metric: 'uptime',
      operator: 'gte',
      threshold: '3' as never,
      enabled: false,
    });
    const out = evaluate(r, { metric: 'uptime', consecutiveFailures: 100 });
    expect(out.fires).toBe(false);
  });

  it('error_rate fires when errorsInWindow > threshold', () => {
    const r = rule({ metric: 'error_rate', operator: 'gt', threshold: '10' as never });
    const out = evaluate(r, { metric: 'error_rate', errorsInWindow: 11 });
    expect(out.fires).toBe(true);
  });

  it('throws when metric mismatches', () => {
    const r = rule({ metric: 'uptime', operator: 'gte', threshold: '3' as never });
    expect(() => evaluate(r, { metric: 'ssl_expiry', daysRemaining: 1 })).toThrow();
  });
});
