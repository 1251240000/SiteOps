/**
 * Alert evaluator.
 *
 * Pure function that decides whether a rule should fire given the current
 * observation. The "current observation" is whatever metric the rule cares
 * about — uptime failures count, ssl/domain remaining days, lighthouse
 * performance score, etc. Higher-level glue (`alert-fire` worker job)
 * gathers the metric value, calls `evaluate`, and then writes a row in
 * `alerts` if the rule fires.
 */
import type { AlertMetric, AlertOperator, AlertRule } from '@siteops/db';

export type AlertEvaluation = { fires: false } | { fires: true; value: number; message: string };

export type MetricInput =
  | { metric: 'uptime'; consecutiveFailures: number }
  | { metric: 'ssl_expiry'; daysRemaining: number }
  | { metric: 'domain_expiry'; daysRemaining: number }
  | { metric: 'lighthouse_perf'; score: number }
  | { metric: 'error_rate'; errorsInWindow: number }
  | { metric: 'custom'; value: number };

function compare(op: AlertOperator, lhs: number, rhs: number): boolean {
  switch (op) {
    case 'lt':
      return lhs < rhs;
    case 'lte':
      return lhs <= rhs;
    case 'gt':
      return lhs > rhs;
    case 'gte':
      return lhs >= rhs;
    case 'eq':
      return lhs === rhs;
  }
}

function valueFor(metric: AlertMetric, input: MetricInput): number {
  if (input.metric !== metric) {
    throw new Error(`evaluator: metric mismatch (${input.metric} vs ${metric})`);
  }
  switch (input.metric) {
    case 'uptime':
      return input.consecutiveFailures;
    case 'ssl_expiry':
    case 'domain_expiry':
      return input.daysRemaining;
    case 'lighthouse_perf':
      return input.score;
    case 'error_rate':
      return input.errorsInWindow;
    case 'custom':
      return input.value;
  }
}

function defaultMessage(rule: AlertRule, value: number): string {
  switch (rule.metric) {
    case 'uptime':
      return `Uptime check failed ${value} times in a row`;
    case 'ssl_expiry':
      return `SSL certificate expires in ${value}d`;
    case 'domain_expiry':
      return `Domain registration expires in ${value}d`;
    case 'lighthouse_perf':
      return `Lighthouse performance ${Math.round(value * 100)}/100`;
    case 'error_rate':
      return `${value} errors in window`;
    case 'custom':
      return `Custom metric value ${value}`;
  }
}

export function evaluate(rule: AlertRule, input: MetricInput): AlertEvaluation {
  if (!rule.enabled) return { fires: false };
  const value = valueFor(rule.metric, input);
  const threshold = Number(rule.threshold);
  if (!Number.isFinite(threshold)) return { fires: false };
  const triggered = compare(rule.operator, value, threshold);
  if (!triggered) return { fires: false };
  return { fires: true, value, message: defaultMessage(rule, value) };
}

export { compare as _compare };
