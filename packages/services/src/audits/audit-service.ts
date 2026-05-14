/**
 * Audit service.
 *
 * Orchestrates an end-to-end SEO audit:
 *   1. start a row in `audit_runs` (`status='running'`)
 *   2. fetch homepage / robots / sitemap via `httpFetch`
 *   3. run `runSeoRules` over the inputs
 *   4. write each finding to `audit_findings`
 *   5. close the run with summary + score (`status='success'`/`failed`)
 *
 * The HTTP fetch wrapper is dependency-injected so unit tests can drive
 * the orchestration without the network.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { auditRepo, type AuditRun, type Db, type NewAuditFinding } from '@siteops/db';
import { http } from '@siteops/integrations';
import { AppError, type Logger } from '@siteops/shared';

import {
  type RuleFinding,
  type SeoAuditInput,
  type SeoPageInput,
  type SeoRobotsInput,
  type SeoSitemapInput,
  runSeoRules,
  summarise,
} from './seo-rules.js';

export type AuditServiceDeps = {
  db: Db;
  logger?: Pick<Logger, 'info' | 'warn' | 'error'>;
  /** Override the HTTP client (used in tests). */
  fetch?: typeof http.httpFetch;
  /** Override the audit data directory (raw report sink). */
  dataDir?: string;
};

export type SeoAuditResult = {
  run: AuditRun;
  findings: RuleFinding[];
  summary: ReturnType<typeof summarise>;
  rawReportPath: string | null;
};

const DEFAULT_DATA_DIR = process.env['AUDIT_DATA_DIR'] ?? '/var/lib/siteops/audits';

function abs(url: string, base: string): string {
  try {
    return new URL(url, base).toString();
  } catch {
    return url;
  }
}

async function fetchHomepage(fetcher: typeof http.httpFetch, url: string): Promise<SeoPageInput> {
  try {
    const res = await fetcher(url, { timeoutMs: 15_000, maxBytes: 1024 * 1024 });
    return { url: res.finalUrl, status: res.status, html: res.body };
  } catch (err) {
    return {
      url,
      status: 0,
      html: '',
      ...{ _error: err instanceof Error ? err.message : String(err) },
    } as SeoPageInput;
  }
}

async function fetchRobots(
  fetcher: typeof http.httpFetch,
  origin: string,
): Promise<SeoRobotsInput> {
  try {
    const res = await fetcher(abs('/robots.txt', origin), {
      timeoutMs: 10_000,
      maxBytes: 256 * 1024,
    });
    return {
      fetched: res.status >= 200 && res.status < 300,
      status: res.status,
      text: res.body,
    };
  } catch {
    return { fetched: false, status: null, text: '' };
  }
}

async function fetchSitemap(
  fetcher: typeof http.httpFetch,
  origin: string,
): Promise<SeoSitemapInput> {
  const candidates = [abs('/sitemap.xml', origin), abs('/sitemap_index.xml', origin)];
  const attempts: SeoSitemapInput['attempts'] = [];
  for (const url of candidates) {
    try {
      const res = await fetcher(url, { timeoutMs: 10_000, maxBytes: 512 * 1024 });
      attempts.push({
        url,
        status: res.status,
        ok: res.status >= 200 && res.status < 300 && res.body.length > 0,
        xml: res.body,
      });
      if (attempts[attempts.length - 1]!.ok) break;
    } catch {
      attempts.push({ url, status: null, ok: false, xml: '' });
    }
  }
  return { attempts };
}

async function writeReport(
  dataDir: string,
  auditId: string,
  payload: unknown,
): Promise<string | null> {
  try {
    const path = join(dataDir, `${auditId}.json`);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(payload, null, 2), 'utf8');
    return path;
  } catch {
    return null;
  }
}

export const auditService = {
  /**
   * Kick off + execute a single SEO audit. The caller is expected to
   * supply the site's primary URL.
   */
  async runSeoAudit(
    deps: AuditServiceDeps,
    input: { siteId: string; siteUrl: string },
  ): Promise<SeoAuditResult> {
    const fetcher = deps.fetch ?? http.httpFetch;
    const dataDir = deps.dataDir ?? DEFAULT_DATA_DIR;
    const run = await auditRepo.startRun(deps.db, {
      siteId: input.siteId,
      auditType: 'seo',
    });

    let homepage: SeoPageInput;
    let robots: SeoRobotsInput;
    let sitemap: SeoSitemapInput;
    let origin = '';
    try {
      origin = new URL(input.siteUrl).origin;
    } catch {
      throw new AppError('Invalid site URL', {
        code: 'validation_failed',
        status: 400,
        details: { url: input.siteUrl },
      });
    }

    try {
      [homepage, robots, sitemap] = await Promise.all([
        fetchHomepage(fetcher, input.siteUrl),
        fetchRobots(fetcher, origin),
        fetchSitemap(fetcher, origin),
      ]);
    } catch (err) {
      await auditRepo.finishRun(deps.db, run.id, {
        status: 'failed',
        summary: {
          error: err instanceof Error ? err.message : String(err),
        } as Record<string, unknown>,
      });
      throw err;
    }

    const seoInput: SeoAuditInput = { homepage, robots, sitemap };
    const findings = runSeoRules(seoInput);
    const summary = summarise(findings);

    for (const f of findings) {
      const insert: NewAuditFinding = {
        auditRunId: run.id,
        siteId: input.siteId,
        severity: f.severity,
        code: f.code,
        title: f.title,
        message: f.message ?? null,
        url: f.url ?? null,
        meta: f.meta ?? null,
      };
      await auditRepo.addFinding(deps.db, insert);
    }

    const rawReportPath = await writeReport(dataDir, run.id, {
      input: seoInput,
      findings,
      summary,
      finishedAt: new Date().toISOString(),
    });

    const finished = await auditRepo.finishRun(deps.db, run.id, {
      status: 'success',
      score: summary.score,
      summary: summary as unknown as Record<string, unknown>,
      rawReportPath,
    });

    deps.logger?.info(
      {
        event: 'audit.seo_completed',
        auditRunId: run.id,
        siteId: input.siteId,
        score: summary.score,
        findings: summary.total,
      },
      'seo audit completed',
    );

    return {
      run: finished ?? run,
      findings,
      summary,
      rawReportPath,
    };
  },

  async getRun(deps: AuditServiceDeps, id: string): Promise<AuditRun> {
    const row = await auditRepo.getRun(deps.db, id);
    if (!row) {
      throw new AppError('Audit run not found', {
        code: 'not_found',
        status: 404,
        details: { id },
      });
    }
    return row;
  },

  async listRuns(
    deps: AuditServiceDeps,
    opts: Parameters<typeof auditRepo.list>[1] = {},
  ): Promise<ReturnType<typeof auditRepo.list>> {
    return auditRepo.list(deps.db, opts);
  },

  async listFindings(
    deps: AuditServiceDeps,
    auditRunId: string,
  ): Promise<ReturnType<typeof auditRepo.listFindings>> {
    return auditRepo.listFindings(deps.db, auditRunId);
  },
};
