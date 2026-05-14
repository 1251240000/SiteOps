/**
 * Search Console integration service.
 *
 * MVP scope (per T20):
 *   - Pull D-3 (data has 2–3 day delay), 90-day backfill on first sync
 *   - Three slices: aggregate (no dims), top queries, top countries+devices
 *   - Tokens refreshed via `credentialsService`
 */

import { integrationStateRepo, metricsRepo, siteRepo, type Db, type Site } from '@siteops/db';
import { searchConsole } from '@siteops/integrations';
import type { Logger } from '@siteops/shared';

import type { AlertCipher } from '../alerts/cipher.js';
import { credentialsService } from './credentials-service.js';

const PROVIDER = 'gsc' as const;
const SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';

export type GscServiceDeps = {
  db: Db;
  cipher: AlertCipher;
  logger?: Pick<Logger, 'info' | 'warn' | 'error'>;
  /** Test injection. */
  clientFactory?: (accessToken: string) => searchConsole.SearchConsoleClient;
  oauthFetch?: searchConsole.OAuth2Fetch;
  now?: () => Date;
};

export type GscOAuthConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

export type GscSyncSummary = {
  siteId: string;
  property: string;
  rowsWritten: number;
  error?: string;
};

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function defaultClient(accessToken: string): searchConsole.SearchConsoleClient {
  return new searchConsole.SearchConsoleClient({ accessToken });
}

export const gscService = {
  /** Build the consent-screen URL the admin must visit. */
  buildAuthUrl(cfg: GscOAuthConfig, state?: string): string {
    return searchConsole.buildAuthUrl(cfg, {
      scope: SCOPE,
      ...(state ? { state } : {}),
    });
  },

  /** Finish the OAuth dance: exchange code → encrypt → store. */
  async completeOAuth(deps: GscServiceDeps, cfg: GscOAuthConfig, code: string): Promise<void> {
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

  /** Refresh the access token if needed; returns a fresh access token. */
  async getAccessToken(deps: GscServiceDeps, cfg: GscOAuthConfig): Promise<string> {
    const stored = await credentialsService.read({ db: deps.db, cipher: deps.cipher }, PROVIDER);
    if (!stored?.refreshToken) {
      throw new Error('GSC credentials not configured');
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

  async syncSite(
    deps: GscServiceDeps,
    cfg: GscOAuthConfig,
    site: Pick<Site, 'id' | 'searchConsoleProperty'>,
    options: { backfillDays?: number; lagDays?: number; topQueryLimit?: number } = {},
  ): Promise<GscSyncSummary> {
    if (!site.searchConsoleProperty) {
      throw new Error('syncSite: site missing searchConsoleProperty');
    }
    const summary: GscSyncSummary = {
      siteId: site.id,
      property: site.searchConsoleProperty,
      rowsWritten: 0,
    };

    let accessToken: string;
    try {
      accessToken = await this.getAccessToken(deps, cfg);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      summary.error = msg;
      await integrationStateRepo.markError(deps.db, PROVIDER, site.id, msg);
      return summary;
    }

    const state = await integrationStateRepo.get(deps.db, PROVIDER, site.id);
    const isFirstSync = !state?.lastSyncedAt;
    const lagDays = options.lagDays ?? 3;
    const backfillDays = options.backfillDays ?? (isFirstSync ? 90 : 3);
    const now = (deps.now ?? (() => new Date()))();
    const endDate = ymd(new Date(now.getTime() - lagDays * 24 * 60 * 60 * 1000));
    const startDate = ymd(new Date(now.getTime() - (lagDays + backfillDays) * 24 * 60 * 60 * 1000));

    try {
      const client = (deps.clientFactory ?? defaultClient)(accessToken);
      // 1. Aggregate (by date only).
      const aggregate = await client.searchAnalyticsQuery(site.searchConsoleProperty, {
        startDate,
        endDate,
        dimensions: ['date'],
      });
      for (const row of aggregate.rows ?? []) {
        const date = row.keys?.[0];
        if (!date) continue;
        await metricsRepo.upsertSearchConsoleDaily(deps.db, {
          siteId: site.id,
          date,
          query: null,
          country: null,
          device: null,
          clicks: row.clicks,
          impressions: row.impressions,
          ctr: row.ctr,
          position: row.position,
        });
        summary.rowsWritten += 1;
      }
      // 2. Top queries (limit per task).
      const topQ = await client.searchAnalyticsQuery(site.searchConsoleProperty, {
        startDate,
        endDate,
        dimensions: ['date', 'query'],
        rowLimit: options.topQueryLimit ?? 1000,
      });
      for (const row of topQ.rows ?? []) {
        const [date, query] = row.keys ?? [];
        if (!date) continue;
        await metricsRepo.upsertSearchConsoleDaily(deps.db, {
          siteId: site.id,
          date,
          query: query ?? null,
          country: null,
          device: null,
          clicks: row.clicks,
          impressions: row.impressions,
          ctr: row.ctr,
          position: row.position,
        });
        summary.rowsWritten += 1;
      }
      await integrationStateRepo.markSuccess(deps.db, PROVIDER, site.id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      summary.error = msg;
      await integrationStateRepo.markError(deps.db, PROVIDER, site.id, msg);
      deps.logger?.warn(
        { event: 'gsc.site_sync_failed', siteId: site.id, err: { message: msg } },
        'gsc site sync failed',
      );
    }
    deps.logger?.info(
      { event: 'gsc.site_sync', siteId: site.id, rows: summary.rowsWritten },
      'gsc site sync done',
    );
    return summary;
  },

  async syncAll(deps: GscServiceDeps, cfg: GscOAuthConfig): Promise<GscSyncSummary[]> {
    const all = await siteRepo.list(deps.db, { limit: 100, filters: { status: 'active' } });
    const eligible = all.items.filter((s) => s.searchConsoleProperty);
    const out: GscSyncSummary[] = [];
    for (const site of eligible) {
      out.push(await this.syncSite(deps, cfg, site));
    }
    return out;
  },
};
