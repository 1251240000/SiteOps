import { AlertTriangle } from 'lucide-react';

import { cn } from '@/lib/utils';

export type LowEfficiencyFlag = 'negative_roi' | 'low_rpm' | 'declining_revenue';

const FLAG_LABELS: Record<LowEfficiencyFlag, string> = {
  negative_roi: 'Negative ROI',
  low_rpm: 'Low RPM',
  declining_revenue: 'Declining revenue',
};

/**
 * Yellow banner shown above the ROI table when one or more sites trip a
 * `low-efficiency` rule. Stays out of the way (compact, single line)
 * when there is nothing to flag.
 */
export function LowEfficiencyBanner({
  count,
  flagCounts,
  className,
}: {
  count: number;
  /** Per-flag occurrence count across all flagged sites. */
  flagCounts: Partial<Record<LowEfficiencyFlag, number>>;
  className?: string;
}) {
  if (count === 0) return null;

  const sorted = (Object.entries(flagCounts) as [LowEfficiencyFlag, number][])
    .filter(([, c]) => c > 0)
    .sort(([, a], [, b]) => b - a);

  return (
    <section
      role="status"
      aria-live="polite"
      className={cn(
        'flex items-center gap-3 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm',
        className,
      )}
    >
      <AlertTriangle className="size-5 text-warning" aria-hidden />
      <div className="flex-1">
        <p className="font-medium text-foreground">
          {count} site{count === 1 ? '' : 's'} need attention
        </p>
        <p className="text-xs text-muted-foreground">
          {sorted.map(([flag, c]) => `${FLAG_LABELS[flag]} (${c})`).join(' · ')}
        </p>
      </div>
    </section>
  );
}
