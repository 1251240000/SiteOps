import { useTranslations } from 'next-intl';

export type LhScores = {
  performance: number;
  seo: number;
  bestPractices: number;
  accessibility: number;
};

function colour(score: number): string {
  if (score < 0.5) return 'text-destructive';
  if (score < 0.9) return 'text-warning';
  return 'text-success';
}

export function LighthouseScoreCard({ scores }: { scores: LhScores }) {
  const t = useTranslations('pages.audits.lighthouse');
  const cats: Array<[string, number]> = [
    [t('performance'), scores.performance],
    [t('seo'), scores.seo],
    [t('bestPractices'), scores.bestPractices],
    [t('accessibility'), scores.accessibility],
  ];
  return (
    <section
      aria-label={t('ariaLabel')}
      className="grid grid-cols-2 gap-3 rounded-lg border border-border bg-card p-4 md:grid-cols-4"
    >
      {cats.map(([label, score]) => (
        <div key={label} className="flex flex-col items-start gap-1">
          <span className="text-xs text-muted-foreground">{label}</span>
          <span className={`text-2xl font-semibold ${colour(score)}`}>
            {Math.round(score * 100)}
          </span>
        </div>
      ))}
    </section>
  );
}
