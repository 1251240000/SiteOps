/**
 * SSL / domain expiry service.
 *
 * Probes the TLS certificate of a hostname (port 443) and writes the
 * `valid_to` / issuer back to `domains`. The probe is intentionally
 * separated from `node:tls` so we can mock it for unit tests; the default
 * implementation uses Node's built-in `tls.connect`.
 */
import { connect, type ConnectionOptions, type TLSSocket } from 'node:tls';

import { domainRepo, siteRepo, type Db, type Domain } from '@siteops/db';
import { isValidDomain, normalizeDomain, type Logger } from '@siteops/shared';

const PROBE_TIMEOUT_MS = 10_000;

export type SslProbeResult = {
  domain: string;
  ok: boolean;
  validTo: Date | null;
  issuer: string | null;
  error: string | null;
};

export type SslProbe = (hostname: string) => Promise<SslProbeResult>;

export type SslExpiryFinding = {
  domainId: string;
  siteId: string | null;
  domain: string;
  type: 'ssl' | 'domain';
  daysUntil: number | null;
  /** Human-readable threshold used to flag the row. */
  thresholdDays: number;
};

export type SslServiceDeps = {
  db: Db;
  logger?: Pick<Logger, 'info' | 'warn' | 'error'>;
  /** Override the TLS probe (used in tests). */
  probe?: SslProbe;
};

export const SSL_ALERT_THRESHOLD_DAYS = 14;
export const DOMAIN_ALERT_THRESHOLD_DAYS = 30;

/**
 * Default TLS probe: open a port-443 connection, read `peerCertificate`,
 * close.
 */
export const defaultSslProbe: SslProbe = async (hostname) => {
  return new Promise<SslProbeResult>((resolve) => {
    let settled = false;
    const finish = (out: SslProbeResult) => {
      if (settled) return;
      settled = true;
      try {
        socket.destroy();
      } catch {
        /* ignore */
      }
      resolve(out);
    };
    const timer = setTimeout(
      () =>
        finish({
          domain: hostname,
          ok: false,
          validTo: null,
          issuer: null,
          error: 'timeout',
        }),
      PROBE_TIMEOUT_MS,
    );
    const opts: ConnectionOptions = {
      host: hostname,
      port: 443,
      servername: hostname,
      // We want to learn about expired/untrusted certs, not error on them.
      rejectUnauthorized: false,
      ALPNProtocols: ['http/1.1'],
    };
    const socket: TLSSocket = connect(opts);
    socket.once('secureConnect', () => {
      clearTimeout(timer);
      const cert = socket.getPeerCertificate(false);
      if (!cert || Object.keys(cert).length === 0) {
        finish({
          domain: hostname,
          ok: false,
          validTo: null,
          issuer: null,
          error: 'no_certificate',
        });
        return;
      }
      const validTo = cert.valid_to ? new Date(cert.valid_to) : null;
      const issuer =
        typeof cert.issuer === 'object' && cert.issuer !== null && 'CN' in cert.issuer
          ? String((cert.issuer as { CN?: string }).CN ?? '')
          : null;
      finish({
        domain: hostname,
        ok: !!validTo && !Number.isNaN(validTo.getTime()),
        validTo: validTo && !Number.isNaN(validTo.getTime()) ? validTo : null,
        issuer: issuer || null,
        error: null,
      });
    });
    socket.once('error', (err) => {
      clearTimeout(timer);
      finish({
        domain: hostname,
        ok: false,
        validTo: null,
        issuer: null,
        error: err.message,
      });
    });
  });
};

function daysUntilSsl(date: Date | string | null): number | null {
  if (!date) return null;
  const target = typeof date === 'string' ? new Date(date) : date;
  if (Number.isNaN(target.getTime())) return null;
  return Math.round((target.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
}

export const sslService = {
  probe: defaultSslProbe,

  /**
   * Probe one domain row and persist the result. Returns the updated row
   * plus the resulting `daysUntilSslExpiry` for callers that want to log /
   * fire alerts.
   */
  async probeAndStore(
    deps: SslServiceDeps,
    domain: Domain,
  ): Promise<{ domain: Domain; daysUntilSslExpiry: number | null; probe: SslProbeResult }> {
    const probe = deps.probe ?? defaultSslProbe;
    const host = normalizeDomain(domain.domain);
    if (!isValidDomain(host)) {
      deps.logger?.warn(
        { event: 'ssl.skipped_invalid_domain', domainId: domain.id, domain: domain.domain },
        'skipping SSL probe for non-public domain',
      );
      return {
        domain,
        daysUntilSslExpiry: null,
        probe: {
          domain: host,
          ok: false,
          validTo: null,
          issuer: null,
          error: 'invalid_domain',
        },
      };
    }
    const result = await probe(host);
    const updated = await domainRepo.updateSslInfo(deps.db, domain.id, {
      sslExpiresAt: result.validTo,
      sslIssuer: result.issuer,
    });
    deps.logger?.info(
      {
        event: 'ssl.probed',
        domainId: domain.id,
        domain: domain.domain,
        ok: result.ok,
        issuer: result.issuer,
        validTo: result.validTo?.toISOString(),
        error: result.error,
      },
      'ssl probe complete',
    );
    return {
      domain: updated ?? domain,
      daysUntilSslExpiry: daysUntilSsl(result.validTo),
      probe: result,
    };
  },

  /**
   * Walk every domain in the registry and probe SSL for each. Returns
   * findings whose remaining days fall under the alert thresholds.
   */
  async runAll(deps: SslServiceDeps): Promise<{ probed: number; findings: SslExpiryFinding[] }> {
    const rows = await domainRepo.listAll(deps.db);
    const findings: SslExpiryFinding[] = [];
    for (const row of rows) {
      const { probe } = await this.probeAndStore(deps, row);
      const sslDays = daysUntilSsl(probe.validTo);
      const domainDays = daysUntilSsl(row.expiresAt);
      if (sslDays !== null && sslDays <= SSL_ALERT_THRESHOLD_DAYS) {
        findings.push({
          domainId: row.id,
          siteId: row.siteId ?? null,
          domain: row.domain,
          type: 'ssl',
          daysUntil: sslDays,
          thresholdDays: SSL_ALERT_THRESHOLD_DAYS,
        });
      }
      if (domainDays !== null && domainDays <= DOMAIN_ALERT_THRESHOLD_DAYS) {
        findings.push({
          domainId: row.id,
          siteId: row.siteId ?? null,
          domain: row.domain,
          type: 'domain',
          daysUntil: domainDays,
          thresholdDays: DOMAIN_ALERT_THRESHOLD_DAYS,
        });
      }
    }
    deps.logger?.info(
      { event: 'ssl.run_all', probed: rows.length, findings: findings.length },
      'ssl/domain expiry sweep complete',
    );
    return { probed: rows.length, findings };
  },
};

export { daysUntilSsl };

// Re-export to keep `siteRepo` in the tree-shake graph for tests that want
// to access it through `@siteops/services/domains/ssl-service`.
export { siteRepo as _siteRepoForTests };
