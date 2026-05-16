import { useTranslations } from 'next-intl';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { type Site } from '@/lib/queries/sites';

const STATUS_VARIANT: Record<string, 'success' | 'warning' | 'muted'> = {
  active: 'success',
  paused: 'warning',
  archived: 'muted',
};

const KNOWN_STATUS = ['active', 'paused', 'archived'] as const;
type KnownStatus = (typeof KNOWN_STATUS)[number];
const KNOWN_TYPE = ['directory', 'tool', 'content', 'forum', 'landing'] as const;
type KnownType = (typeof KNOWN_TYPE)[number];

/** Read-only "facts" panel used on the site Overview tab. */
export function SiteSummary({ site }: { site: Site }) {
  const t = useTranslations('pages.sites.summary');
  const tStatus = useTranslations('enums.siteStatus');
  const tType = useTranslations('enums.siteType');
  const statusLabel = (KNOWN_STATUS as readonly string[]).includes(site.status)
    ? tStatus(site.status as KnownStatus)
    : site.status;
  const typeLabel = (KNOWN_TYPE as readonly string[]).includes(site.siteType)
    ? tType(site.siteType as KnownType)
    : site.siteType;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-3">
          {site.name}
          <Badge variant={STATUS_VARIANT[site.status] ?? 'outline'}>{statusLabel}</Badge>
          <Badge variant="outline">{typeLabel}</Badge>
        </CardTitle>
        <a
          href={site.primaryUrl}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          {site.primaryUrl}
        </a>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
          <Cell label={t('slug')} value={site.slug} />
          <Cell label={t('health')} value={String(site.healthScore)} />
          <Cell label={t('country')} value={site.targetCountry ?? '—'} />
          <Cell label={t('language')} value={site.targetLanguage ?? '—'} />
          <Cell label={t('framework')} value={site.techStack?.framework ?? '—'} />
          <Cell label={t('hosting')} value={site.techStack?.hosting ?? '—'} />
          <Cell label={t('repo')} value={site.repoUrl ?? '—'} mono />
          <Cell label={t('analytics')} value={site.analyticsProvider ?? '—'} />
        </dl>
        {site.tags.length > 0 ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {site.tags.map((tag) => (
              <Badge key={tag} variant="secondary">
                {tag}
              </Badge>
            ))}
          </div>
        ) : null}
        {site.notes ? (
          <p className="mt-4 whitespace-pre-line text-sm text-muted-foreground">{site.notes}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function Cell({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className={mono ? 'mt-1 font-mono text-xs break-all' : 'mt-1 text-sm'}>{value}</dd>
    </div>
  );
}
