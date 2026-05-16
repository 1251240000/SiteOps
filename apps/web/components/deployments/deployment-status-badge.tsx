'use client';

import { CheckCircle2, CircleDashed, Hammer, MinusCircle, XCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Badge } from '@/components/ui/badge';
import { type DeploymentStatus } from '@siteops/shared/constants';

const VARIANT: Record<DeploymentStatus, 'success' | 'warning' | 'destructive' | 'muted'> = {
  queued: 'muted',
  building: 'warning',
  success: 'success',
  failed: 'destructive',
  cancelled: 'muted',
};

const ICON: Record<DeploymentStatus, typeof CheckCircle2> = {
  queued: CircleDashed,
  building: Hammer,
  success: CheckCircle2,
  failed: XCircle,
  cancelled: MinusCircle,
};

export function DeploymentStatusBadge({ status }: { status: DeploymentStatus }) {
  const t = useTranslations('enums.deploymentStatus');
  const Icon = ICON[status];
  return (
    <Badge variant={VARIANT[status]} className="gap-1">
      <Icon className="size-3" aria-hidden />
      {t(status)}
    </Badge>
  );
}
