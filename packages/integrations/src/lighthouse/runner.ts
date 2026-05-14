/**
 * Lighthouse runner.
 *
 * Real Lighthouse runs require Chromium + `lighthouse` npm pkg, which adds
 * ~200MB to the worker image. For the M2 vertical slice we expose a
 * pluggable interface (`LighthouseRunner`) and ship a *stub* implementation
 * that returns a placeholder LHR document. The worker calls the runner via
 * `getLighthouseRunner()`; production deployments can swap in the real
 * runner by setting `LIGHTHOUSE_RUNNER=real` and installing the optional
 * dependencies. This keeps CI green and unit tests deterministic.
 */
export type LhCategoryScores = {
  performance: number;
  seo: number;
  bestPractices: number;
  accessibility: number;
};

export type LhAuditEntry = {
  id: string;
  title: string;
  /** 0–1 (1 = pass, 0 = fail); `null` when category isn't applicable. */
  score: number | null;
  description?: string;
};

export type LhResult = {
  /** Origin URL fed into Lighthouse. */
  requestedUrl: string;
  /** URL Lighthouse actually loaded (final after redirects). */
  finalUrl: string;
  fetchedAt: string;
  categories: LhCategoryScores;
  audits: LhAuditEntry[];
  /** Raw LHR JSON. Stub mode returns `null` (we'd persist Bytes to disk). */
  rawJson: unknown;
};

export type LighthouseRunner = (input: { url: string }) => Promise<LhResult>;

/**
 * Stub runner. Produces a believable but deterministic LHR shape that's
 * good enough for downstream service tests + UI rendering.
 */
export const stubLighthouseRunner: LighthouseRunner = async ({ url }) => {
  return {
    requestedUrl: url,
    finalUrl: url,
    fetchedAt: new Date().toISOString(),
    categories: {
      performance: 0.78,
      seo: 0.92,
      bestPractices: 0.85,
      accessibility: 0.88,
    },
    audits: [
      {
        id: 'first-contentful-paint',
        title: 'First Contentful Paint',
        score: 0.82,
      },
      {
        id: 'largest-contentful-paint',
        title: 'Largest Contentful Paint',
        score: 0.6,
      },
      {
        id: 'cumulative-layout-shift',
        title: 'Cumulative Layout Shift',
        score: 0.95,
      },
    ],
    rawJson: null,
  };
};

let registered: LighthouseRunner = stubLighthouseRunner;

export function registerLighthouseRunner(runner: LighthouseRunner): void {
  registered = runner;
}

export function getLighthouseRunner(): LighthouseRunner {
  return registered;
}

/** Map an LH 0–1 score to our finding severity vocabulary. */
export function lhScoreSeverity(score: number | null): 'info' | 'warning' | 'critical' {
  if (score === null) return 'info';
  if (score < 0.5) return 'critical';
  if (score < 0.9) return 'warning';
  return 'info';
}
