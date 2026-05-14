import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { type Site } from '@/lib/queries/sites';

const STATUS_VARIANT: Record<string, 'success' | 'warning' | 'muted'> = {
  active: 'success',
  paused: 'warning',
  archived: 'muted',
};

/** Read-only "facts" panel used on the site Overview tab. */
export function SiteSummary({ site }: { site: Site }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-3">
          {site.name}
          <Badge variant={STATUS_VARIANT[site.status] ?? 'outline'}>{site.status}</Badge>
          <Badge variant="outline">{site.siteType}</Badge>
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
          <Cell label="Slug" value={site.slug} />
          <Cell label="Health" value={String(site.healthScore)} />
          <Cell label="Country" value={site.targetCountry ?? '—'} />
          <Cell label="Language" value={site.targetLanguage ?? '—'} />
          <Cell label="Framework" value={site.techStack?.framework ?? '—'} />
          <Cell label="Hosting" value={site.techStack?.hosting ?? '—'} />
          <Cell label="Repo" value={site.repoUrl ?? '—'} mono />
          <Cell label="Analytics" value={site.analyticsProvider ?? '—'} />
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
