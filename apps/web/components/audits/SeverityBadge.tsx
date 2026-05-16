import { useTranslations } from 'next-intl';

import { Badge } from '@/components/ui/badge';

const VARIANT: Record<string, 'success' | 'warning' | 'destructive' | 'muted'> = {
  info: 'muted',
  warning: 'warning',
  error: 'destructive',
  critical: 'destructive',
};

const KNOWN_SEVERITIES = ['info', 'warning', 'error', 'critical'] as const;
type KnownSeverity = (typeof KNOWN_SEVERITIES)[number];

export function SeverityBadge({ severity }: { severity: string }) {
  const t = useTranslations('enums.severity');
  const label = (KNOWN_SEVERITIES as readonly string[]).includes(severity)
    ? t(severity as KnownSeverity)
    : severity;
  return <Badge variant={VARIANT[severity] ?? 'muted'}>{label}</Badge>;
}
