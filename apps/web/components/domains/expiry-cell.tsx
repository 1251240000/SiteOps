import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export interface ExpiryCellProps {
  date: string | null;
  daysUntil: number | null;
  /** Below this threshold the row gets a warning tint. Default 30. */
  warnWithinDays?: number;
  className?: string;
}

/** Renders a date plus a "in N days" badge, coloured by urgency. */
export function ExpiryCell({ date, daysUntil, warnWithinDays = 30, className }: ExpiryCellProps) {
  if (!date) {
    return <span className={cn('text-muted-foreground', className)}>—</span>;
  }
  const expired = daysUntil !== null && daysUntil < 0;
  const expiringSoon = daysUntil !== null && daysUntil >= 0 && daysUntil <= warnWithinDays;
  const tone: 'success' | 'warning' | 'destructive' = expired
    ? 'destructive'
    : expiringSoon
      ? 'warning'
      : 'success';
  const label =
    daysUntil === null
      ? date
      : expired
        ? `${Math.abs(daysUntil)}d ago`
        : daysUntil === 0
          ? 'today'
          : `in ${daysUntil}d`;
  return (
    <span className={cn('flex items-center gap-2', className)}>
      <time dateTime={date} className="tabular-nums text-foreground">
        {date}
      </time>
      <Badge variant={tone}>{label}</Badge>
    </span>
  );
}
