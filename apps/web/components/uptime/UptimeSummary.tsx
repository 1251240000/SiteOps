import { Activity, Clock, ShieldCheck } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { StatCard } from '@/components/common/stat-card';

export type UptimeSummaryValue = {
  okRate: number;
  total: number;
  ok: number;
  avgResponseTimeMs: number | null;
};

export function UptimeSummary({
  value,
  windowLabel,
}: {
  value: UptimeSummaryValue;
  windowLabel: string;
}) {
  const t = useTranslations('pages.uptime.summary');
  const pct = (value.okRate * 100).toFixed(value.okRate >= 0.999 ? 2 : 1);
  return (
    <section aria-label={t('ariaLabel')} className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <StatCard
        label={t('uptimeLabel', { window: windowLabel })}
        value={`${pct}%`}
        icon={ShieldCheck}
        hint={t('uptimeHint', { ok: value.ok, total: value.total })}
      />
      <StatCard
        label={t('avgResponse')}
        value={value.avgResponseTimeMs == null ? '—' : `${value.avgResponseTimeMs} ms`}
        icon={Clock}
        hint={t('avgResponseHint')}
      />
      <StatCard
        label={t('failedChecks')}
        value={`${value.total - value.ok}`}
        icon={Activity}
        hint={
          value.total === 0
            ? t('noData')
            : t('windowPercent', {
                percent: (((value.total - value.ok) / value.total) * 100).toFixed(1),
              })
        }
      />
    </section>
  );
}
