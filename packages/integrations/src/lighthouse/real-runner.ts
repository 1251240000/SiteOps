/**
 * Real Lighthouse runner.
 *
 * Wraps `chrome-launcher` + the `lighthouse` Node library so the worker can
 * collect genuine performance / SEO / a11y / best-practices scores instead
 * of the deterministic stub used by tests.
 *
 * Both modules are declared as `optionalDependencies` of this package, so
 * the import is **lazy** — `createRealLighthouseRunner()` only resolves
 * them when actually invoked. In a CI install without optional deps the
 * worker keeps booting with the stub runner; only deployments that opt in
 * (set `LIGHTHOUSE_RUNNER=real` and ship Chromium in the image) pay the
 * download cost.
 *
 * Configuration knobs are read from env at call time (not module load) so
 * the same compiled artefact works in dev, CI, and prod:
 *   - `CHROME_PATH` / `PUPPETEER_EXECUTABLE_PATH` — system Chromium path
 *   - `LIGHTHOUSE_FORM_FACTOR` — `mobile` (default) or `desktop`
 *
 * The runner runs Chromium with `--no-sandbox` because the worker container
 * runs as root inside Docker; never expose this binary outside that
 * controlled environment.
 */
import type { LhAuditEntry, LhCategoryScores, LhResult, LighthouseRunner } from './runner.js';

type ChromeFlags = readonly string[];

const DEFAULT_CHROME_FLAGS: ChromeFlags = [
  '--headless=new',
  '--no-sandbox',
  '--disable-gpu',
  '--disable-dev-shm-usage',
];

function pickChromePath(): string | undefined {
  return (
    process.env['CHROME_PATH'] ||
    process.env['PUPPETEER_EXECUTABLE_PATH'] ||
    process.env['GOOGLE_CHROME_BIN'] ||
    undefined
  );
}

function pickFormFactor(): 'mobile' | 'desktop' {
  return process.env['LIGHTHOUSE_FORM_FACTOR'] === 'desktop' ? 'desktop' : 'mobile';
}

type ChromeLauncherModule = {
  launch: (opts: {
    chromePath?: string;
    chromeFlags?: ChromeFlags;
  }) => Promise<{ port: number; kill: () => Promise<void> }>;
};

type LighthouseModule = (
  url: string,
  flags: { port: number; output: string; logLevel: string },
  config: Record<string, unknown> | undefined,
) => Promise<{ lhr: LighthouseReport } | undefined>;

type LighthouseAudit = {
  id: string;
  title?: string;
  description?: string;
  score: number | null;
};
type LighthouseCategory = {
  score: number | null;
  auditRefs?: Array<{ id: string }>;
};
type LighthouseReport = {
  requestedUrl: string;
  finalUrl?: string;
  finalDisplayedUrl?: string;
  fetchTime: string;
  categories: {
    performance?: LighthouseCategory;
    seo?: LighthouseCategory;
    'best-practices'?: LighthouseCategory;
    accessibility?: LighthouseCategory;
  };
  audits: Record<string, LighthouseAudit>;
};

/**
 * Resolve the optional deps at call time. Both are typed with `any` because
 * they're listed under `optionalDependencies`; pulling their `@types` into
 * the build would force the workspace install to download Chromium even in
 * dev/CI where we never use the real runner.
 */
async function loadDeps(): Promise<{
  chromeLauncher: ChromeLauncherModule;
  lighthouse: LighthouseModule;
}> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dynImport = (s: string): Promise<any> => import(/* @vite-ignore */ s);
  let chromeLauncherMod: unknown;
  let lighthouseMod: unknown;
  try {
    chromeLauncherMod = await dynImport('chrome-launcher');
  } catch (err) {
    throw new Error(
      `LIGHTHOUSE_RUNNER=real requires the optional dependency 'chrome-launcher'. Install it (or rebuild the worker image with the optional deps enabled): ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
  try {
    lighthouseMod = await dynImport('lighthouse');
  } catch (err) {
    throw new Error(
      `LIGHTHOUSE_RUNNER=real requires the optional dependency 'lighthouse'. Install it (or rebuild the worker image with the optional deps enabled): ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const lhAny = lighthouseMod as any;
  const lighthouse = (lhAny.default ?? lhAny) as LighthouseModule;
  return { chromeLauncher: chromeLauncherMod as ChromeLauncherModule, lighthouse };
}

function num(v: number | null | undefined): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function toScores(report: LighthouseReport): LhCategoryScores {
  return {
    performance: num(report.categories.performance?.score),
    seo: num(report.categories.seo?.score),
    bestPractices: num(report.categories['best-practices']?.score),
    accessibility: num(report.categories.accessibility?.score),
  };
}

/** Flatten the union of audit refs across categories so consumers see a
 * single de-duplicated list with stable ordering. */
function toAudits(report: LighthouseReport): LhAuditEntry[] {
  const seen = new Set<string>();
  const out: LhAuditEntry[] = [];
  for (const cat of Object.values(report.categories)) {
    if (!cat?.auditRefs) continue;
    for (const ref of cat.auditRefs) {
      if (seen.has(ref.id)) continue;
      const audit = report.audits[ref.id];
      if (!audit) continue;
      seen.add(ref.id);
      const entry: LhAuditEntry = {
        id: audit.id,
        title: audit.title ?? audit.id,
        score: typeof audit.score === 'number' ? audit.score : null,
      };
      if (audit.description) entry.description = audit.description;
      out.push(entry);
    }
  }
  return out;
}

export function createRealLighthouseRunner(): LighthouseRunner {
  return async ({ url }) => {
    const { chromeLauncher, lighthouse } = await loadDeps();
    const chromePath = pickChromePath();
    const chrome = await chromeLauncher.launch({
      ...(chromePath ? { chromePath } : {}),
      chromeFlags: DEFAULT_CHROME_FLAGS,
    });
    try {
      const result = await lighthouse(
        url,
        { port: chrome.port, output: 'json', logLevel: 'error' },
        { extends: 'lighthouse:default', settings: { formFactor: pickFormFactor() } },
      );
      if (!result?.lhr) {
        throw new Error(`Lighthouse returned no report for ${url}`);
      }
      const lhr = result.lhr;
      const out: LhResult = {
        requestedUrl: lhr.requestedUrl,
        finalUrl: lhr.finalDisplayedUrl ?? lhr.finalUrl ?? lhr.requestedUrl,
        fetchedAt: lhr.fetchTime ?? new Date().toISOString(),
        categories: toScores(lhr),
        audits: toAudits(lhr),
        rawJson: lhr,
      };
      return out;
    } finally {
      try {
        await chrome.kill();
      } catch {
        // best-effort
      }
    }
  };
}
