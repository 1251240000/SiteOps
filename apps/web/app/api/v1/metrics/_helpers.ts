/**
 * Shared helpers for `/api/v1/metrics/*` routes.
 *
 * Centralises:
 *   - the `from`/`to` date-window validation (must be `YYYY-MM-DD` and
 *     `from <= to`)
 *   - the default 30-day window applied when callers omit either field
 *   - granularity / metric / limit coercions reused by multiple routes
 *
 * Keeping these here avoids drift between `/global/*` and `/sites/[id]/*`
 * which would otherwise have to copy-paste the same superRefine logic.
 */
import type { RefinementCtx } from 'zod';

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type DateWindow = { from: string; to: string };

/** Format a UTC `Date` as `YYYY-MM-DD`. */
export function toIsoDate(date: Date): string {
  const yyyy = date.getUTCFullYear().toString().padStart(4, '0');
  const mm = (date.getUTCMonth() + 1).toString().padStart(2, '0');
  const dd = date.getUTCDate().toString().padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/** zod superRefine for an optional `{from?, to?}` window. */
export function isoDateRangeSchema(
  value: { from?: string; to?: string },
  ctx: RefinementCtx,
): void {
  if (value.from !== undefined && !ISO_DATE_RE.test(value.from)) {
    ctx.addIssue({
      code: 'custom',
      path: ['from'],
      message: '`from` must be YYYY-MM-DD',
    });
  }
  if (value.to !== undefined && !ISO_DATE_RE.test(value.to)) {
    ctx.addIssue({
      code: 'custom',
      path: ['to'],
      message: '`to` must be YYYY-MM-DD',
    });
  }
  if (
    value.from !== undefined &&
    value.to !== undefined &&
    ISO_DATE_RE.test(value.from) &&
    ISO_DATE_RE.test(value.to) &&
    Date.parse(`${value.from}T00:00:00Z`) > Date.parse(`${value.to}T00:00:00Z`)
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['from'],
      message: '`from` must be on or before `to`',
    });
  }
}

/**
 * Resolve `{from?, to?}` into a concrete inclusive window. Default `to` is
 * today (UTC), default span is 30 days.
 */
export function defaultRange(value: { from?: string; to?: string }, days = 30): DateWindow {
  const todayUtc = new Date();
  const todayKey = toIsoDate(todayUtc);
  const to = value.to ?? todayKey;
  let from = value.from;
  if (!from) {
    const toMid = new Date(`${to}T00:00:00Z`).getTime();
    const fromTs = toMid - (days - 1) * MS_PER_DAY;
    from = toIsoDate(new Date(fromTs));
  }
  return { from, to };
}
