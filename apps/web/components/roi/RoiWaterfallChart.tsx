'use client';

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

const usd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 2,
});

export type RoiWaterfallDatum = {
  /** Bucket label, e.g. "Revenue", "Hosting", "Domain". */
  label: string;
  /** Signed dollar amount: positive for revenue, negative for cost. */
  value: number;
  /** Running balance after this bar lands. */
  running: number;
  /** Distinct render flavour (controls colour). */
  kind: 'revenue' | 'cost' | 'total';
};

/**
 * Single-site waterfall: starts at $0, climbs by revenue components,
 * falls by cost components, ends at profit. Implemented as a stacked
 * bar chart where the lower "filler" bar is transparent — the classic
 * Recharts technique.
 *
 * Caller is responsible for assembling the buckets via
 * `buildRoiWaterfall(detail)`.
 */
export function RoiWaterfallChart({ data }: { data: RoiWaterfallDatum[] }) {
  // Recharts wants positive heights, so we project each datum into a
  // (start, height) pair. The "start" bar is rendered as invisible
  // padding below the actual value bar.
  const projected = data.map((d, idx) => {
    const prev = idx === 0 ? 0 : data[idx - 1]!.running;
    const start = d.kind === 'total' ? 0 : Math.min(prev, d.running);
    const height = d.kind === 'total' ? Math.abs(d.running) : Math.abs(d.value);
    return {
      label: d.label,
      start,
      height,
      kind: d.kind,
      sign: d.value >= 0 ? 'pos' : 'neg',
      raw: d.value,
      running: d.running,
    };
  });

  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={projected} margin={{ top: 16, right: 12, bottom: 12, left: 12 }}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
          <XAxis dataKey="label" tick={{ fontSize: 12 }} />
          <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => usd.format(Number(v))} width={72} />
          <Tooltip
            cursor={{ fill: 'hsl(var(--muted) / 0.4)' }}
            formatter={(_value, _name, item) => {
              const p = item.payload as (typeof projected)[number];
              return [usd.format(p.raw), p.label];
            }}
            labelFormatter={(label) => label as string}
          />
          {/* Invisible spacer */}
          <Bar dataKey="start" stackId="w" fill="transparent" isAnimationActive={false} />
          <Bar
            dataKey="height"
            stackId="w"
            isAnimationActive={false}
            // Per-bar colour: revenue = success, cost = destructive, total = primary.
            // Recharts doesn't expose CSS-var fill on a per-cell basis without
            // a <Cell/> child, so we keep the colour mapping uniform per
            // chart instance and let the consumer call this with one kind.
            fill="currentColor"
            className="text-primary"
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/**
 * Build waterfall buckets from a site-ROI detail. Order: revenue
 * components first (ad, affiliate), then cost components, then total.
 */
export function buildRoiWaterfall(detail: {
  breakdown: {
    adRevenue: number;
    affiliateRevenue: number;
    hostingCost: number;
    domainCost: number;
    contentCost: number;
    adsSpendCost: number;
    otherCost: number;
  };
  profit: number;
}): RoiWaterfallDatum[] {
  const b = detail.breakdown;
  const buckets: Array<Omit<RoiWaterfallDatum, 'running'>> = [];
  if (b.adRevenue > 0) buckets.push({ label: 'Ad rev.', value: b.adRevenue, kind: 'revenue' });
  if (b.affiliateRevenue > 0)
    buckets.push({ label: 'Affiliate', value: b.affiliateRevenue, kind: 'revenue' });
  if (b.hostingCost > 0) buckets.push({ label: 'Hosting', value: -b.hostingCost, kind: 'cost' });
  if (b.domainCost > 0) buckets.push({ label: 'Domain', value: -b.domainCost, kind: 'cost' });
  if (b.contentCost > 0) buckets.push({ label: 'Content', value: -b.contentCost, kind: 'cost' });
  if (b.adsSpendCost > 0)
    buckets.push({ label: 'Ads spend', value: -b.adsSpendCost, kind: 'cost' });
  if (b.otherCost > 0) buckets.push({ label: 'Other', value: -b.otherCost, kind: 'cost' });

  let running = 0;
  const out: RoiWaterfallDatum[] = buckets.map((b2) => {
    running += b2.value;
    return { ...b2, running };
  });
  out.push({ label: 'Profit', value: detail.profit, running: detail.profit, kind: 'total' });
  return out;
}
