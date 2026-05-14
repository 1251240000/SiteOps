/**
 * AdSense integration service. Same OAuth refresh dance as GSC, but talks
 * to `accounts.reports:generate` and writes to `adsense_daily`.
 */

import { domainRepo, integrationStateRepo, metricsRepo, type Db } from '@siteops/db';
import { adsense, searchConsole } from '@siteops/integrations';
import type { Logger } from '@siteops/shared';

import type { AlertCipher } from '../alerts/cipher.js';
import { credentialsService } from './credentials-service.js';

const PROVIDER = 'adsense' as const;
const SCOPE = 'https://www.googleapis.com/auth/adsense.readonly';

export type AdSenseOAuthConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

export type AdSenseServiceDeps = {
  db: Db;
  cipher: AlertCipher;
  logger?: Pick<Logger, 'info' | 'warn' | 'error'>;
  clientFactory?: (accessToken: string) => adsense.AdSenseClient;
  oauthFetch?: searchConsole.OAuth2Fetch;
  now?: () => Date;
};

export type AdSenseSyncSummary = {
  rowsFetched: number;
  rowsWritten: number;
  unmatchedDomains: string[];
  error?: string;
};

function dateFromYmd(s: string): { year: number; month: number; day: number } {
  const [year, month, day] = s.split('-').map((p) => Number(p));
  if (!year || !month || !day) {
    throw new Error(`invalid date: ${s}`);
  }
  return { year, month, day };
}

function dateToGoogle(d: Date): { year: number; month: number; day: number } {
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

function defaultClient(accessToken: string): adsense.AdSenseClient {
  return new adsense.AdSenseClient({ accessToken });
}

function normalizeDomain(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^www\./, '');
}

export const adsenseService = {
  buildAuthUrl(cfg: AdSenseOAuthConfig, state?: string): string {
    return searchConsole.buildAuthUrl(cfg, {
      scope: SCOPE,
      ...(state ? { state } : {}),
    });
  },

  async completeOAuth(
    deps: AdSenseServiceDeps,
    cfg: AdSenseOAuthConfig,
    code: string,
  ): Promise<void> {
    const tokens = await searchConsole.exchangeCode(
      {
        ...cfg,
        ...(deps.oauthFetch ? { fetch: deps.oauthFetch } : {}),
      },
      code,
    );
    if (!tokens.refresh_token) {
      throw new Error('OAuth response missing refresh_token; ensure prompt=consent');
    }
    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();
    await credentialsService.save({ db: deps.db, cipher: deps.cipher }, PROVIDER, {
      refreshToken: tokens.refresh_token,
      accessToken: tokens.access_token,
      expiresAt,
      ...(tokens.scope ? { scope: tokens.scope } : {}),
    });
  },

  async getAccessToken(deps: AdSenseServiceDeps, cfg: AdSenseOAuthConfig): Promise<string> {
    const stored = await credentialsService.read({ db: deps.db, cipher: deps.cipher }, PROVIDER);
    if (!stored?.refreshToken) {
      throw new Error('AdSense credentials not configured');
    }
    const now = (deps.now ?? (() => new Date()))().getTime();
    if (stored.accessToken && stored.expiresAt) {
      const expiresMs = new Date(stored.expiresAt).getTime();
      if (expiresMs - 60_000 > now) return stored.accessToken;
    }
    const refreshed = await searchConsole.refreshAccessToken(
      {
        ...cfg,
        ...(deps.oauthFetch ? { fetch: deps.oauthFetch } : {}),
      },
      stored.refreshToken,
    );
    const expiresAt = new Date(now + refreshed.expires_in * 1000).toISOString();
    await credentialsService.save({ db: deps.db, cipher: deps.cipher }, PROVIDER, {
      refreshToken: stored.refreshToken,
      accessToken: refreshed.access_token,
      expiresAt,
      ...(stored.scope ? { scope: stored.scope } : {}),
    });
    return refreshed.access_token;
  },

  /** Sync a date range; returns aggregate stats + unmatched-domain list. */
  async syncRange(
    deps: AdSenseServiceDeps,
    cfg: AdSenseOAuthConfig,
    accountName: string,
    range: { startDate: string; endDate: string },
  ): Promise<AdSenseSyncSummary> {
    const summary: AdSenseSyncSummary = {
      rowsFetched: 0,
      rowsWritten: 0,
      unmatchedDomains: [],
    };

    let accessToken: string;
    try {
      accessToken = await this.getAccessToken(deps, cfg);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      summary.error = msg;
      await integrationStateRepo.markError(deps.db, PROVIDER, null, msg);
      return summary;
    }

    try {
      const client = (deps.clientFactory ?? defaultClient)(accessToken);
      const report = await client.generateReport(accountName, {
        startDate: dateFromYmd(range.startDate),
        endDate: dateFromYmd(range.endDate),
        metrics: [
          'ESTIMATED_EARNINGS',
          'PAGE_VIEWS',
          'IMPRESSIONS',
          'CLICKS',
          'PAGE_VIEWS_RPM',
          'IMPRESSIONS_CTR',
        ],
        dimensions: ['DATE', 'DOMAIN_NAME'],
      });
      const rows = adsense.parseAdSenseReport(report);
      summary.rowsFetched = rows.length;

      // Build a domain → siteId index from the domains table.
      const allDomains = await domainRepo.listAll(deps.db);
      const domainToSite = new Map<string, string>();
      for (const d of allDomains) {
        if (!d.siteId) continue;
        domainToSite.set(normalizeDomain(d.domain), d.siteId);
      }

      const unmatched = new Set<string>();
      for (const row of rows) {
        if (!row.domain) continue;
        const siteId = domainToSite.get(normalizeDomain(row.domain));
        if (!siteId) {
          unmatched.add(row.domain);
          continue;
        }
        const earningsUsd = adsense.toUsd(row.earnings, row.currencyCode);
        await metricsRepo.upsertAdsenseDaily(deps.db, {
          siteId,
          date: row.date,
          earningsUsd,
          pageViews: row.pageViews,
          impressions: row.impressions,
          clicks: row.clicks,
          rpm: row.rpm,
          ctr: row.ctr,
        });
        summary.rowsWritten += 1;
      }
      summary.unmatchedDomains = [...unmatched].sort();
      await integrationStateRepo.markSuccess(deps.db, PROVIDER, null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      summary.error = msg;
      await integrationStateRepo.markError(deps.db, PROVIDER, null, msg);
      deps.logger?.warn(
        { event: 'adsense.sync_failed', err: { message: msg } },
        'adsense sync failed',
      );
    }
    deps.logger?.info(
      {
        event: 'adsense.sync',
        rowsFetched: summary.rowsFetched,
        rowsWritten: summary.rowsWritten,
        unmatched: summary.unmatchedDomains.length,
      },
      'adsense sync done',
    );
    return summary;
  },

  /** Sync yesterday (handles publisher's UTC day) for the given account. */
  async syncDaily(
    deps: AdSenseServiceDeps,
    cfg: AdSenseOAuthConfig,
    accountName: string,
  ): Promise<AdSenseSyncSummary> {
    const now = (deps.now ?? (() => new Date()))();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const ymd = yesterday.toISOString().slice(0, 10);
    return this.syncRange(deps, cfg, accountName, { startDate: ymd, endDate: ymd });
  },

  /** Convenience: sync last N days (default 30). Used on first install. */
  async backfill(
    deps: AdSenseServiceDeps,
    cfg: AdSenseOAuthConfig,
    accountName: string,
    days = 30,
  ): Promise<AdSenseSyncSummary> {
    const now = (deps.now ?? (() => new Date()))();
    const endDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const startDate = new Date(endDate.getTime() - days * 24 * 60 * 60 * 1000);
    return this.syncRange(deps, cfg, accountName, {
      startDate: startDate.toISOString().slice(0, 10),
      endDate: endDate.toISOString().slice(0, 10),
    });
  },

  /** Quick liveness check that returns the first AdSense account name. */
  async firstAccount(deps: AdSenseServiceDeps, cfg: AdSenseOAuthConfig): Promise<string | null> {
    const accessToken = await this.getAccessToken(deps, cfg);
    const client = (deps.clientFactory ?? defaultClient)(accessToken);
    const accounts = await client.listAccounts();
    return accounts[0]?.name ?? null;
  },

  // Helpers exported for tests
  _toGoogleDate: dateToGoogle,
};
