import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';

import { uptime as uptimeSvc } from '@siteops/services';
import { isAppError, siteIdParamSchema } from '@siteops/shared';

import { RecentFailuresList } from '@/components/uptime/RecentFailuresList';
import { UptimeChart } from '@/components/uptime/UptimeChart';
import { UptimeSummary } from '@/components/uptime/UptimeSummary';
import { getDb } from '@/lib/db';

import { TriggerUptimeCheck } from './trigger';

export const dynamic = 'force-dynamic';

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function readWindowHours(value: string | string[] | undefined): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const n = Number.parseInt(raw ?? '', 10);
  if (!Number.isFinite(n) || n <= 0 || n > 30 * 24) return 24;
  return n;
}

export default async function SiteUptimePage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const parsed = siteIdParamSchema.safeParse({ id });
  if (!parsed.success) notFound();

  const sp = await searchParams;
  const windowHours = readWindowHours(sp['window']);

  const deps = { db: getDb() };
  const to = new Date();
  const from = new Date(to.getTime() - windowHours * 60 * 60 * 1000);
  const granularity = windowHours > 7 * 24 ? '1d' : windowHours > 24 ? '1h' : '5m';

  const t = await getTranslations('pages.uptime.page');

  try {
    const [summary, series, failures] = await Promise.all([
      uptimeSvc.uptimeService.summary(deps, parsed.data.id, windowHours * 60 * 60 * 1000),
      uptimeSvc.uptimeService.series(deps, parsed.data.id, from, to, granularity),
      uptimeSvc.uptimeService.recentFailures(deps, parsed.data.id, 10),
    ]);

    const windowLabel =
      windowHours === 24
        ? t('window24h')
        : windowHours === 24 * 7
          ? t('window7d')
          : windowHours === 24 * 30
            ? t('window30d')
            : t('windowCustom', { hours: windowHours });

    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <nav aria-label={t('timeWindowAria')} className="flex gap-1 text-xs">
            {[
              { hours: 24, label: '24h' },
              { hours: 24 * 7, label: '7d' },
              { hours: 24 * 30, label: '30d' },
            ].map((w) => (
              <a
                key={w.hours}
                href={`?window=${w.hours}`}
                className={`rounded-md px-2 py-1 transition-colors ${
                  windowHours === w.hours
                    ? 'bg-accent text-accent-foreground'
                    : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
                }`}
              >
                {w.label}
              </a>
            ))}
          </nav>
          <TriggerUptimeCheck siteId={parsed.data.id} />
        </div>

        <UptimeSummary value={summary} windowLabel={windowLabel} />
        <UptimeChart
          series={series.map((p) => ({
            bucket: p.bucket,
            total: p.total,
            ok: p.ok,
            avgResponseTimeMs: p.avgResponseTimeMs,
          }))}
        />

        <section aria-label={t('recentFailuresAria')} className="space-y-2">
          <header className="text-sm font-semibold">{t('recentFailuresTitle')}</header>
          <RecentFailuresList
            items={failures.map((f) => ({
              id: f.id.toString(),
              checkedAt: f.checkedAt,
              statusCode: f.statusCode,
              responseTimeMs: f.responseTimeMs,
              error: f.error,
              url: f.url,
            }))}
          />
        </section>
      </div>
    );
  } catch (err) {
    if (isAppError(err) && err.status === 404) notFound();
    throw err;
  }
}
