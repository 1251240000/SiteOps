/**
 * Lighthouse service.
 *
 * Mirrors `auditService.runSeoAudit` but instead of running rules in-
 * process we hand off to a pluggable `LighthouseRunner` (stubbed by
 * default — see `@siteops/integrations/lighthouse/runner.ts`). Each failed
 * `LhAuditEntry` becomes an `audit_findings` row; the four category scores
 * land in `audit_runs.summary`.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import {
  auditRepo,
  type AuditRun,
  type Db,
  type FindingSeverity,
  type NewAuditFinding,
} from '@siteops/db';
import { lighthouse } from '@siteops/integrations';
import { AppError, type Logger } from '@siteops/shared';

const DEFAULT_DATA_DIR = process.env['LIGHTHOUSE_DATA_DIR'] ?? '/var/lib/siteops/lighthouse';

export type LighthouseServiceDeps = {
  db: Db;
  logger?: Pick<Logger, 'info' | 'warn' | 'error'>;
  /** Override runner (defaults to whichever runner is registered). */
  runner?: lighthouse.LighthouseRunner;
  dataDir?: string;
};

export type LighthouseAuditResult = {
  run: AuditRun;
  scores: lighthouse.LhCategoryScores;
  findingsCount: number;
  rawReportPath: string | null;
};

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

function summaryScore(scores: lighthouse.LhCategoryScores): number {
  return Math.round(
    ((scores.performance + scores.seo + scores.bestPractices + scores.accessibility) / 4) * 100,
  );
}

export const lighthouseService = {
  async runLighthouse(
    deps: LighthouseServiceDeps,
    input: { siteId: string; siteUrl: string },
  ): Promise<LighthouseAuditResult> {
    const runner = deps.runner ?? lighthouse.getLighthouseRunner();
    const dataDir = deps.dataDir ?? DEFAULT_DATA_DIR;
    const run = await auditRepo.startRun(deps.db, {
      siteId: input.siteId,
      auditType: 'lighthouse',
    });

    let lhr: lighthouse.LhResult;
    try {
      lhr = await runner({ url: input.siteUrl });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await auditRepo.addFinding(deps.db, {
        auditRunId: run.id,
        siteId: input.siteId,
        severity: 'critical',
        code: 'lighthouse.run_failed',
        title: 'Lighthouse run failed',
        message,
        meta: null,
      });
      await auditRepo.finishRun(deps.db, run.id, {
        status: 'failed',
        summary: { error: message } as Record<string, unknown>,
      });
      deps.logger?.warn(
        { event: 'audit.lighthouse_failed', auditRunId: run.id, err: { message } },
        'lighthouse run failed',
      );
      throw new AppError('Lighthouse run failed', {
        code: 'lighthouse_failed',
        status: 502,
        details: { auditRunId: run.id, message },
      });
    }

    const scores = lhr.categories;
    let findingsCount = 0;
    for (const audit of lhr.audits) {
      const severity: FindingSeverity = lighthouse.lhScoreSeverity(audit.score);
      if (severity === 'info' && (audit.score ?? 1) >= 0.9) continue;
      const insert: NewAuditFinding = {
        auditRunId: run.id,
        siteId: input.siteId,
        severity,
        code: `lighthouse.${audit.id}`,
        title: audit.title,
        message: audit.description ?? null,
        url: null,
        meta: { score: audit.score },
      };
      await auditRepo.addFinding(deps.db, insert);
      findingsCount += 1;
    }

    const rawReportPath = await writeReport(dataDir, run.id, lhr);

    const finished = await auditRepo.finishRun(deps.db, run.id, {
      status: 'success',
      score: summaryScore(scores),
      summary: scores as unknown as Record<string, unknown>,
      rawReportPath,
    });

    deps.logger?.info(
      {
        event: 'audit.lighthouse_completed',
        auditRunId: run.id,
        siteId: input.siteId,
        scores,
      },
      'lighthouse run complete',
    );

    return {
      run: finished ?? run,
      scores,
      findingsCount,
      rawReportPath,
    };
  },
};

export { summaryScore as lighthouseSummaryScore };
