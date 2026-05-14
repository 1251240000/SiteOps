import { type LucideIcon } from 'lucide-react';
import { type ReactNode } from 'react';

import { cn } from '@/lib/utils';

export interface StatCardProps {
  label: string;
  value: ReactNode;
  delta?: { value: string; tone?: 'positive' | 'negative' | 'neutral' };
  icon?: LucideIcon;
  hint?: ReactNode;
  className?: string;
}

const toneClass: Record<NonNullable<NonNullable<StatCardProps['delta']>['tone']>, string> = {
  positive: 'text-success',
  negative: 'text-destructive',
  neutral: 'text-muted-foreground',
};

/** Small KPI tile used on the dashboard home and detail pages. */
export function StatCard({ label, value, delta, icon: Icon, hint, className }: StatCardProps) {
  const tone = delta?.tone ?? 'neutral';
  return (
    <article
      className={cn(
        'flex flex-col gap-2 rounded-lg border border-border bg-card p-5 text-card-foreground shadow-sm',
        className,
      )}
    >
      <div className="flex items-center justify-between text-sm font-medium text-muted-foreground">
        <span>{label}</span>
        {Icon ? <Icon className="size-4" aria-hidden /> : null}
      </div>
      <div className="text-2xl font-semibold tracking-tight">{value}</div>
      {delta || hint ? (
        <div className="flex items-baseline justify-between gap-2 text-xs">
          {delta ? <span className={toneClass[tone]}>{delta.value}</span> : <span />}
          {hint ? <span className="text-muted-foreground">{hint}</span> : null}
        </div>
      ) : null}
    </article>
  );
}
