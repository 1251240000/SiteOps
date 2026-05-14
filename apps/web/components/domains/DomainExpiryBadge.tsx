import { Badge } from '@/components/ui/badge';

export function DomainExpiryBadge({
  daysUntil,
  thresholdWarning = 30,
  thresholdCritical = 7,
  label = 'expires',
}: {
  daysUntil: number | null;
  thresholdWarning?: number;
  thresholdCritical?: number;
  label?: string;
}) {
  if (daysUntil === null) {
    return <Badge variant="muted">{label}: unknown</Badge>;
  }
  if (daysUntil < 0) {
    return (
      <Badge variant="destructive">
        {label}: expired ({Math.abs(daysUntil)}d ago)
      </Badge>
    );
  }
  if (daysUntil <= thresholdCritical) {
    return (
      <Badge variant="destructive">
        {label}: {daysUntil}d
      </Badge>
    );
  }
  if (daysUntil <= thresholdWarning) {
    return (
      <Badge variant="warning">
        {label}: {daysUntil}d
      </Badge>
    );
  }
  return (
    <Badge variant="success">
      {label}: {daysUntil}d
    </Badge>
  );
}
