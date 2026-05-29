import { Gauge, MousePointerClick, Users, Zap } from 'lucide-react';
import { getTranslations } from 'next-intl/server';

import type { analytics } from '@siteops/services';

import { StatCard } from '@/components/common/stat-card';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

type AnalyticsOverview = Awaited<
  ReturnType<typeof analytics.analyticsAggregateService.getSiteOverview>
>;

const intFmt = new Intl.NumberFormat('en-US');
const msFmt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const clsFmt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 });

function formatVital(name: string, value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  if (name === 'CLS') return clsFmt.format(value);
  return `${msFmt.format(value)} ms`;
}

function vitalVariant(
  name: string,
  value: number | null,
): 'success' | 'warning' | 'destructive' | 'muted' {
  if (value === null || !Number.isFinite(value)) return 'muted';
  const thresholds: Record<string, { good: number; poor: number }> = {
    LCP: { good: 2500, poor: 4000 },
    CLS: { good: 0.1, poor: 0.25 },
    INP: { good: 200, poor: 500 },
    FCP: { good: 1800, poor: 3000 },
    TTFB: { good: 800, poor: 1800 },
  };
  const t = thresholds[name];
  if (!t) return 'muted';
  if (value <= t.good) return 'success';
  if (value <= t.poor) return 'warning';
  return 'destructive';
}

export async function AnalyticsSummary({ overview }: { overview: AnalyticsOverview }) {
  const t = await getTranslations('pages.analytics');
  const vitalNames = ['LCP', 'CLS', 'INP', 'FCP', 'TTFB'];

  return (
    <div className="space-y-6">
      <section
        aria-label={t('kpis.ariaLabel')}
        className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4"
      >
        <StatCard
          label={t('kpis.pageViews')}
          value={intFmt.format(overview.pv)}
          icon={MousePointerClick}
          hint={t('source')}
        />
        <StatCard
          label={t('kpis.uniqueVisitors')}
          value={intFmt.format(overview.uv)}
          icon={Users}
          hint={t('visitorHint')}
        />
        <StatCard
          label={t('kpis.sessions')}
          value={intFmt.format(overview.sessions)}
          icon={Zap}
          hint={t('sessionHint')}
        />
        <StatCard
          label={t('kpis.vitals')}
          value={formatVital('LCP', overview.webVitalsP75.LCP ?? null)}
          icon={Gauge}
          hint={t('kpis.lcpP75')}
        />
      </section>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-1">
          <CardHeader>
            <CardTitle>{t('topPages.title')}</CardTitle>
          </CardHeader>
          <CardContent>
            {overview.topPages.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('topPages.empty')}</p>
            ) : (
              <ol className="space-y-3">
                {overview.topPages.map((row) => (
                  <li key={row.path} className="flex items-center justify-between gap-3 text-sm">
                    <span className="truncate font-mono" title={row.path}>
                      {row.path}
                    </span>
                    <Badge variant="secondary">{intFmt.format(row.pv)}</Badge>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>

        <Card className="xl:col-span-1">
          <CardHeader>
            <CardTitle>{t('topReferrers.title')}</CardTitle>
          </CardHeader>
          <CardContent>
            {overview.topReferrers.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('topReferrers.empty')}</p>
            ) : (
              <ol className="space-y-3">
                {overview.topReferrers.map((row) => (
                  <li
                    key={row.referrer}
                    className="flex items-center justify-between gap-3 text-sm"
                  >
                    <span className="truncate" title={row.referrer}>
                      {row.referrer}
                    </span>
                    <Badge variant="secondary">{intFmt.format(row.count)}</Badge>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>

        <Card className="xl:col-span-1">
          <CardHeader>
            <CardTitle>{t('webVitals.title')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-1">
              {vitalNames.map((name) => {
                const value = overview.webVitalsP75[name] ?? null;
                return (
                  <div
                    key={name}
                    className="flex items-center justify-between rounded-md border border-border p-3"
                  >
                    <div>
                      <div className="text-sm font-medium">{name}</div>
                      <div className="text-xs text-muted-foreground">{t('webVitals.p75')}</div>
                    </div>
                    <Badge variant={vitalVariant(name, value)}>{formatVital(name, value)}</Badge>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
