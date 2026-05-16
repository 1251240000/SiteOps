const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type ResolvedRange = { from: string; to: string };

function isoToday(): string {
  const d = new Date();
  return [
    d.getUTCFullYear().toString().padStart(4, '0'),
    (d.getUTCMonth() + 1).toString().padStart(2, '0'),
    d.getUTCDate().toString().padStart(2, '0'),
  ].join('-');
}

function isoMinusDays(base: string, days: number): string {
  const ts = Date.parse(`${base}T00:00:00Z`);
  const d = new Date(ts - days * MS_PER_DAY);
  return [
    d.getUTCFullYear().toString().padStart(4, '0'),
    (d.getUTCMonth() + 1).toString().padStart(2, '0'),
    d.getUTCDate().toString().padStart(2, '0'),
  ].join('-');
}

export function resolveRange(
  from: string | null | undefined,
  to: string | null | undefined,
  defaultDays = 30,
): ResolvedRange {
  const safeTo = to && ISO_RE.test(to) ? to : isoToday();
  const safeFrom = from && ISO_RE.test(from) ? from : isoMinusDays(safeTo, defaultDays - 1);
  return { from: safeFrom, to: safeTo };
}
