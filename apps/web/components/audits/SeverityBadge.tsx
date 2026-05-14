import { Badge } from '@/components/ui/badge';

const VARIANT: Record<string, 'success' | 'warning' | 'destructive' | 'muted'> = {
  info: 'muted',
  warning: 'warning',
  error: 'destructive',
  critical: 'destructive',
};

export function SeverityBadge({ severity }: { severity: string }) {
  return <Badge variant={VARIANT[severity] ?? 'muted'}>{severity}</Badge>;
}
