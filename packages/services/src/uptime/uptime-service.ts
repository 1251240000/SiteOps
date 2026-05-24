/**
 * Uptime service.
 *
 * Wraps `uptimeRepo` with the small amount of business logic the worker
 * and API need:
 *   - perform a single HTTP probe with SSRF guard + timeout (pure node fetch
 *     so it works in both the worker process and ad-hoc test scripts)
 *   - persist the result, then re-compute the site's `health_score`
 *     (last 24h ok ratio × 100; clamped 0–100)
 *   - expose summary / series helpers reused by the dashboard route
 *
 * The probe itself is split out (`probeUrl`) so unit tests can drive the
 * scoring logic without a real network call.
 */
import { siteRepo, uptimeRepo, type Db, type UptimeBucket, type UptimeCheck } from '@siteops/db';
import { AppError, assertOutboundUrl, type Cursor, type Logger } from '@siteops/shared';

const HEALTH_WINDOW_MS = 24 * 60 * 60 * 1000;
const PROBE_TIMEOUT_MS = 10_000;

export type UptimeServiceDeps = {
  db: Db;
  logger?: Pick<Logger, 'info' | 'warn' | 'error'>;
};

export type ProbeResult = {
  url: string;
  ok: boolean;
  statusCode: number | null;
  responseTimeMs: number | null;
  error: string | null;
};

export type RecordedProbe = {
  check: UptimeCheck;
  consecutiveFailures: number;
  newHealthScore: number;
};

function nowHrMs(): number {
  return Number(process.hrtime.bigint() / 1_000_000n);
}

function defaultOkPredicate(status: number | null): boolean {
  return status !== null && status >= 200 && status < 400;
}

export const uptimeService = {
  /**
   * Perform a single HTTP probe. Pure function (no DB writes) so callers
   * can wrap it with their own bookkeeping.
   */
  async probeUrl(rawUrl: string): Promise<ProbeResult> {
    try {
      assertOutboundUrl(rawUrl);
    } catch (err) {
      return {
        url: rawUrl,
        ok: false,
        statusCode: null,
        responseTimeMs: null,
        error: err instanceof Error ? err.message : String(err),
      };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
    const start = nowHrMs();
    try {
      const res = await fetch(rawUrl, {
        method: 'GET',
        redirect: 'follow',
        signal: controller.signal,
        headers: {
          'user-agent': 'SiteOpsBot-Uptime/1.0 (+https://siteops.local)',
          accept: '*/*',
        },
      });
      // Drain a small slice of the body to ensure the connection is reused
      // / closed cleanly. We don't care about content.
      try {
        if (res.body) {
          const reader = res.body.getReader();
          await reader.cancel();
        }
      } catch {
        /* ignore */
      }
      const elapsed = nowHrMs() - start;
      return {
        url: rawUrl,
        ok: defaultOkPredicate(res.status),
        statusCode: res.status,
        responseTimeMs: Math.max(0, Math.round(elapsed)),
        error: null,
      };
    } catch (err) {
      const elapsed = nowHrMs() - start;
      const aborted = controller.signal.aborted;
      const message =
        err instanceof Error ? (aborted ? 'timeout' : err.message) : String(err ?? 'unknown');
      return {
        url: rawUrl,
        ok: false,
        statusCode: null,
        responseTimeMs: Math.max(0, Math.round(elapsed)),
        error: message,
      };
    } finally {
      clearTimeout(timer);
    }
  },

  /**
   * Probe + persist + score in a single call. Used by both the scheduled
   * worker job and the manual "check now" API endpoint.
   */
  async checkAndRecord(
    deps: UptimeServiceDeps,
    siteId: string,
    overrideUrl?: string,
  ): Promise<RecordedProbe> {
    const site = await siteRepo.getById(deps.db, siteId);
    if (!site) {
      throw new AppError('Site not found', { code: 'not_found', status: 404, details: { siteId } });
    }
    const target = overrideUrl ?? site.primaryUrl;
    const probe = await this.probeUrl(target);
    const insert = await uptimeRepo.insert(deps.db, {
      siteId,
      checkedAt: new Date(),
      url: target,
      statusCode: probe.statusCode ?? null,
      responseTimeMs: probe.responseTimeMs ?? null,
      ok: probe.ok,
      error: probe.error ?? null,
      region: 'local',
    });

    const summary = await uptimeRepo.summary(deps.db, {
      siteId,
      from: new Date(Date.now() - HEALTH_WINDOW_MS),
      to: new Date(),
    });
    const newHealthScore = Math.max(0, Math.min(100, Math.round(summary.okRate * 100)));
    if (newHealthScore !== site.healthScore) {
      await siteRepo.update(deps.db, siteId, { healthScore: newHealthScore });
    }

    const consecutiveFailures = probe.ok
      ? 0
      : await uptimeRepo.consecutiveFailures(deps.db, siteId, 50);

    deps.logger?.info(
      {
        event: 'uptime.checked',
        siteId,
        ok: probe.ok,
        status: probe.statusCode,
        elapsedMs: probe.responseTimeMs,
        consecutiveFailures,
        newHealthScore,
      },
      'uptime check recorded',
    );

    return {
      check: insert,
      consecutiveFailures,
      newHealthScore,
    };
  },

  async summary(
    deps: UptimeServiceDeps,
    siteId: string,
    windowMs = HEALTH_WINDOW_MS,
  ): Promise<ReturnType<typeof uptimeRepo.summary>> {
    return uptimeRepo.summary(deps.db, {
      siteId,
      from: new Date(Date.now() - windowMs),
      to: new Date(),
    });
  },

  async series(
    deps: UptimeServiceDeps,
    siteId: string,
    from: Date,
    to: Date,
    granularity: '5m' | '1h' | '1d' = '5m',
  ): Promise<UptimeBucket[]> {
    return uptimeRepo.series(deps.db, { siteId, from, to, granularity });
  },

  async recentFailures(
    deps: UptimeServiceDeps,
    siteId: string,
    limit = 20,
  ): Promise<UptimeCheck[]> {
    return uptimeRepo.listRecent(deps.db, siteId, { failuresOnly: true, limit });
  },

  /**
   * Keyset-paginated tail-list of uptime checks. Used by the cursor mode
   * on `GET /api/v1/sites/{id}/uptime?cursor=...` (T36). The cursor is
   * opaque to the caller; pass back what you got in `meta.cursor.next`.
   */
  async listChecksCursor(
    deps: UptimeServiceDeps,
    siteId: string,
    opts: { cursor?: Cursor; limit?: number; failuresOnly?: boolean; okOnly?: boolean } = {},
  ): Promise<{ items: UptimeCheck[]; nextCursor: string | null; hasMore: boolean; limit: number }> {
    return uptimeRepo.listCursor(deps.db, siteId, opts);
  },
};

export { HEALTH_WINDOW_MS, PROBE_TIMEOUT_MS };
