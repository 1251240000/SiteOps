/**
 * Domain service.
 *
 * Wraps `domainRepo` and adds:
 *   - normalisation + validation (delegated to `@siteops/shared`)
 *   - the "at most one primary per site" invariant (transactional in repo)
 *   - computed `daysUntilDomainExpiry` / `daysUntilSslExpiry` fields the UI
 *     reads to colour rows
 *   - structured logger emit on create / update / delete / setPrimary
 *
 * The shared `linkPrimaryDomain` helper that `siteService.create` uses
 * predates this module; we re-route it through `domainService.attachPrimary`
 * to keep the "promotion" invariants in one place.
 */
import { eq, and } from 'drizzle-orm';

import {
  domainRepo,
  type Domain,
  type DomainListOptions,
  type DomainListPage,
  domains,
  type Db,
} from '@siteops/db';
import {
  AppError,
  type CreateDomainInput,
  type UpdateDomainInput,
  isValidDomain,
  normalizeDomain,
} from '@siteops/shared';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type DomainView = Domain & {
  daysUntilDomainExpiry: number | null;
  daysUntilSslExpiry: number | null;
};

export type DomainListView = Omit<DomainListPage, 'items'> & {
  items: DomainView[];
};

function startOfUtcDay(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function daysUntil(value: Date | string | null | undefined): number | null {
  if (value == null) return null;
  const target = typeof value === 'string' ? new Date(`${value}T00:00:00Z`) : value;
  if (Number.isNaN(target.getTime())) return null;
  const now = new Date();
  return Math.round((startOfUtcDay(target) - startOfUtcDay(now)) / MS_PER_DAY);
}

export function withComputed(row: Domain): DomainView {
  return {
    ...row,
    daysUntilDomainExpiry: daysUntil(row.expiresAt),
    daysUntilSslExpiry: daysUntil(row.sslExpiresAt ?? null),
  };
}

export type DomainServiceDeps = {
  db: Db;
  logger?: {
    info: (obj: Record<string, unknown>, msg?: string) => void;
    warn: (obj: Record<string, unknown>, msg?: string) => void;
  };
};

function stripUndefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  }
  return out;
}

async function ensureUniqueDomain(db: Db, domain: string, ignoreId?: string): Promise<void> {
  const existing = await domainRepo.getByDomain(db, domain);
  if (existing && existing.id !== ignoreId) {
    throw new AppError('Domain already registered', {
      code: 'conflict',
      status: 409,
      details: { domain },
    });
  }
}

export const domainService = {
  async list(deps: DomainServiceDeps, opts: DomainListOptions): Promise<DomainListView> {
    const page = await domainRepo.list(deps.db, opts);
    return { ...page, items: page.items.map(withComputed) };
  },

  async listForSite(deps: DomainServiceDeps, siteId: string): Promise<DomainView[]> {
    const rows = await domainRepo.listForSite(deps.db, siteId);
    return rows.map(withComputed);
  },

  async getById(deps: DomainServiceDeps, id: string): Promise<DomainView> {
    const row = await domainRepo.getById(deps.db, id);
    if (!row) {
      throw new AppError('Domain not found', { code: 'not_found', status: 404, details: { id } });
    }
    return withComputed(row);
  },

  async create(deps: DomainServiceDeps, input: CreateDomainInput): Promise<DomainView> {
    const normalised = normalizeDomain(input.domain);
    if (!isValidDomain(normalised)) {
      throw new AppError('Invalid domain', {
        code: 'validation_failed',
        status: 400,
        details: { field: 'domain' },
      });
    }

    await ensureUniqueDomain(deps.db, normalised);

    let created: Domain;
    if (input.isPrimary) {
      // Insert + promote inside a single transaction so we never expose a
      // window where two rows of the same site claim `isPrimary=true`.
      created = await deps.db.transaction(async (tx) => {
        await tx
          .update(domains)
          .set({ isPrimary: false })
          .where(and(eq(domains.siteId, input.siteId), eq(domains.isPrimary, true)));
        const inserted = await tx
          .insert(domains)
          .values({
            siteId: input.siteId,
            domain: normalised,
            isPrimary: true,
            ...stripUndefined({
              registrar: input.registrar,
              registeredAt: input.registeredAt,
              expiresAt: input.expiresAt,
              autoRenew: input.autoRenew,
              dnsProvider: input.dnsProvider,
            }),
          })
          .returning();
        const row = inserted[0];
        if (!row) throw new Error('domainService.create: insert returned no row');
        return row;
      });
    } else {
      created = await domainRepo.create(deps.db, {
        siteId: input.siteId,
        domain: normalised,
        isPrimary: false,
        ...stripUndefined({
          registrar: input.registrar,
          registeredAt: input.registeredAt,
          expiresAt: input.expiresAt,
          autoRenew: input.autoRenew,
          dnsProvider: input.dnsProvider,
        }),
      });
    }

    deps.logger?.info(
      {
        event: 'domain.created',
        domainId: created.id,
        siteId: created.siteId,
        domain: created.domain,
        isPrimary: created.isPrimary,
      },
      'domain created',
    );
    return withComputed(created);
  },

  async update(deps: DomainServiceDeps, id: string, patch: UpdateDomainInput): Promise<DomainView> {
    const current = await domainRepo.getById(deps.db, id);
    if (!current) {
      throw new AppError('Domain not found', { code: 'not_found', status: 404, details: { id } });
    }

    const { isPrimary: wantsPrimary, domain: rawDomain, ...rest } = patch;

    let normalisedDomain: string | undefined;
    if (rawDomain !== undefined) {
      normalisedDomain = normalizeDomain(rawDomain);
      if (!isValidDomain(normalisedDomain)) {
        throw new AppError('Invalid domain', {
          code: 'validation_failed',
          status: 400,
          details: { field: 'domain' },
        });
      }
      if (normalisedDomain !== current.domain) {
        await ensureUniqueDomain(deps.db, normalisedDomain, id);
      }
    }

    const baseFields = stripUndefined({
      ...rest,
      ...(normalisedDomain !== undefined ? { domain: normalisedDomain } : {}),
    }) as Partial<typeof domains.$inferInsert>;

    let updated: Domain;
    if (wantsPrimary === true && !current.isPrimary && current.siteId) {
      const siteId = current.siteId;
      // Same transactional guard as `create`: clear old → set new.
      updated = await deps.db.transaction(async (tx) => {
        await tx
          .update(domains)
          .set({ isPrimary: false })
          .where(and(eq(domains.siteId, siteId), eq(domains.isPrimary, true)));
        const res = await tx
          .update(domains)
          .set({ ...baseFields, isPrimary: true })
          .where(eq(domains.id, id))
          .returning();
        const row = res[0];
        if (!row) throw new Error('domainService.update: row vanished mid-transaction');
        return row;
      });
    } else if (wantsPrimary === false && current.isPrimary) {
      // Demoting the *only* primary is fine for now (the site simply loses
      // its canonical entry); UI confirms before doing it.
      const res = await domainRepo.update(deps.db, id, { ...baseFields, isPrimary: false });
      if (!res) {
        throw new AppError('Domain not found', { code: 'not_found', status: 404 });
      }
      updated = res;
    } else {
      const res = await domainRepo.update(deps.db, id, baseFields);
      if (!res) {
        throw new AppError('Domain not found', { code: 'not_found', status: 404 });
      }
      updated = res;
    }

    deps.logger?.info(
      {
        event: 'domain.updated',
        domainId: updated.id,
        siteId: updated.siteId,
        fields: Object.keys(baseFields).concat(wantsPrimary !== undefined ? ['isPrimary'] : []),
      },
      'domain updated',
    );
    return withComputed(updated);
  },

  /** Promote `domainId` to primary for its parent site. Throws 404 on miss. */
  async setPrimary(deps: DomainServiceDeps, siteId: string, domainId: string): Promise<DomainView> {
    const updated = await domainRepo.setPrimary(deps.db, siteId, domainId);
    if (!updated) {
      throw new AppError('Domain not found in that site', {
        code: 'not_found',
        status: 404,
        details: { siteId, domainId },
      });
    }
    deps.logger?.info(
      {
        event: 'domain.primary_set',
        domainId: updated.id,
        siteId,
        domain: updated.domain,
      },
      'domain set as primary',
    );
    return withComputed(updated);
  },

  async remove(deps: DomainServiceDeps, id: string): Promise<DomainView> {
    const row = await domainRepo.delete(deps.db, id);
    if (!row) {
      throw new AppError('Domain not found', { code: 'not_found', status: 404, details: { id } });
    }
    deps.logger?.info(
      {
        event: 'domain.deleted',
        domainId: row.id,
        siteId: row.siteId,
        domain: row.domain,
      },
      'domain deleted',
    );
    return withComputed(row);
  },

  /**
   * Idempotent variant of `create` used by `siteService` when registering a
   * new site. If the domain already exists for the same site it's a no-op;
   * if it belongs to a different site we leave it alone and log a warning.
   *
   * Replaces the old stub in `siteService.linkPrimaryDomain`.
   */
  async attachPrimary(
    deps: DomainServiceDeps,
    siteId: string,
    rawDomain: string,
  ): Promise<DomainView | null> {
    const normalised = normalizeDomain(rawDomain);
    if (!isValidDomain(normalised)) return null;
    const existing = await domainRepo.getByDomain(deps.db, normalised);
    if (existing) {
      if (existing.siteId !== siteId) {
        deps.logger?.warn(
          {
            event: 'domain.attach_skipped',
            siteId,
            domain: normalised,
            owningSiteId: existing.siteId,
          },
          'domain already owned by another site',
        );
        return null;
      }
      if (existing.isPrimary) return withComputed(existing);
      const promoted = await this.setPrimary(deps, siteId, existing.id);
      return promoted;
    }
    return this.create(deps, { siteId, domain: normalised, isPrimary: true });
  },
};

export { daysUntil };
