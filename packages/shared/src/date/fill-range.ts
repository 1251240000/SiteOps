/**
 * Date-range fill helpers shared by the metrics services and dashboards.
 *
 * The metrics tables only contain rows for days that received traffic, but
 * line charts must not show "ghost" gaps — every day in the requested
 * window has to be present (with zero values) so the X-axis renders
 * continuously.
 *
 * The same trick applies to weekly granularity: the SQL aggregator emits
 * the Monday of each ISO week as a date string, and we want to fill in the
 * weeks that were silent.
 *
 * Everything operates on `YYYY-MM-DD` strings in UTC. We never round-trip
 * through the local timezone — DST rules would silently drop or duplicate
 * a day at the boundary.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Strict `YYYY-MM-DD` shape. We accept nothing else. */
export const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Parse `YYYY-MM-DD` into a UTC midnight Date. Throws on malformed input. */
export function parseIsoDate(value: string): Date {
  if (!ISO_DATE_RE.test(value)) {
    throw new Error(`Invalid ISO date: ${value}`);
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid ISO date: ${value}`);
  }
  return date;
}

/** Format a UTC `Date` as `YYYY-MM-DD`. */
export function formatIsoDate(date: Date): string {
  const yyyy = date.getUTCFullYear().toString().padStart(4, '0');
  const mm = (date.getUTCMonth() + 1).toString().padStart(2, '0');
  const dd = date.getUTCDate().toString().padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/** Add `days` (may be negative) to a `YYYY-MM-DD` string. */
export function addDays(date: string, days: number): string {
  const d = parseIsoDate(date);
  d.setUTCDate(d.getUTCDate() + days);
  return formatIsoDate(d);
}

/**
 * Snap a `YYYY-MM-DD` to the Monday of its ISO week (Mon=1, Sun=7). This
 * matches Postgres' `date_trunc('week', ...)` so service code can pre-fill
 * series rows before merging the SQL aggregate.
 */
export function startOfIsoWeek(date: string): string {
  const d = parseIsoDate(date);
  const day = d.getUTCDay(); // 0=Sun..6=Sat
  const offset = day === 0 ? 6 : day - 1; // Mon=0, Sun=6
  d.setUTCDate(d.getUTCDate() - offset);
  return formatIsoDate(d);
}

export type Granularity = 'day' | 'week';

/**
 * Enumerate every bucket date between `from` and `to` inclusive.
 *
 * - `day`  → one entry per UTC day.
 * - `week` → one entry per ISO week (Mon-anchored). The first bucket is
 *   the Monday of the week containing `from`; the last is the Monday of
 *   the week containing `to`.
 */
export function enumerateBuckets(
  from: string,
  to: string,
  granularity: Granularity = 'day',
): string[] {
  const start = parseIsoDate(from);
  const end = parseIsoDate(to);
  if (start.getTime() > end.getTime()) return [];

  if (granularity === 'day') {
    const out: string[] = [];
    const total = Math.floor((end.getTime() - start.getTime()) / MS_PER_DAY) + 1;
    for (let i = 0; i < total; i += 1) {
      const d = new Date(start.getTime() + i * MS_PER_DAY);
      out.push(formatIsoDate(d));
    }
    return out;
  }

  // week
  const out: string[] = [];
  let cursor = startOfIsoWeek(from);
  const stop = startOfIsoWeek(to);
  // Walk forward 7 days at a time; cap iterations as a guard rail.
  for (let i = 0; i < 600; i += 1) {
    out.push(cursor);
    if (cursor === stop) break;
    cursor = addDays(cursor, 7);
  }
  return out;
}

export type FillRangeOptions = {
  from: string;
  to: string;
  granularity?: Granularity;
};

/**
 * Densify a sparse series so that every bucket in `[from, to]` is present.
 *
 * `rows` is keyed by the bucket date (a `YYYY-MM-DD` string). Missing
 * buckets are produced by `factory(date)`; existing buckets are kept
 * verbatim. The output is sorted ascending by date.
 *
 * Rows whose date falls outside the window are silently dropped — the
 * caller is responsible for not seeding them in the first place.
 */
export function fillDateRange<T>(
  rows: Iterable<T>,
  options: FillRangeOptions,
  getKey: (row: T) => string,
  factory: (date: string) => T,
): T[] {
  const { from, to } = options;
  const granularity = options.granularity ?? 'day';
  const buckets = enumerateBuckets(from, to, granularity);
  if (buckets.length === 0) return [];

  const indexed = new Map<string, T>();
  for (const row of rows) {
    const key = getKey(row);
    // Keep the first occurrence; SQL aggregates should already be
    // de-duplicated, but defensive code costs nothing.
    if (!indexed.has(key)) indexed.set(key, row);
  }

  return buckets.map((date) => indexed.get(date) ?? factory(date));
}
