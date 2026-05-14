/**
 * Site service.
 *
 * The single boundary between API routes / workers and the `siteRepo`. It
 * owns:
 *   - slug derivation + conflict resolution
 *   - business validation that Zod can't express (e.g. uniqueness)
 *   - "side-effect orchestration" — currently just `linkPrimaryDomain` (a
 *     stub until T09); future: enqueue uptime + audit jobs on create.
 *
 * Errors surface as `AppError` so the API layer can pass them through to
 * `with-api`'s standard error envelope.
 */
import {
  type Db,
  type NewSite,
  type Site,
  siteRepo,
  type SiteListOptions,
  type SiteListPage,
} from '@siteops/db';
import {
  AppError,
  type CreateSiteInput,
  type UpdateSiteInput,
  nextAvailableSlug,
  slugify,
} from '@siteops/shared';

import { domainService } from '../domains/domain-service.js';

export type { Site, SiteListPage };

/** Strip optional fields that Zod left as `undefined` so we never write
 *  `undefined` into Drizzle insert values (which it interprets as DEFAULT). */
function stripUndefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  }
  return out;
}

function extractHost(primaryUrl: string): string {
  try {
    return new URL(primaryUrl).hostname.toLowerCase();
  } catch {
    return '';
  }
}

/**
 * Best-effort link of a `domains` row to the new site as primary.
 *
 * Implementation lives in `domain-service.attachPrimary` so the primary-
 * uniqueness invariant (one per site) is owned by a single module. This
 * thin wrapper keeps the call site in `siteService.create` readable.
 */
export async function linkPrimaryDomain(db: Db, siteId: string, host: string): Promise<void> {
  if (!host) return;
  await domainService.attachPrimary({ db }, siteId, host);
}

export type SiteServiceDeps = {
  db: Db;
  /** Logger child (optional); when present, create/update events are emitted
   *  as structured records per docs/06-observability.md. */
  logger?: {
    info: (obj: Record<string, unknown>, msg?: string) => void;
    warn: (obj: Record<string, unknown>, msg?: string) => void;
  };
};

export const siteService = {
  /** Pass-through; service exists for symmetry with `create`/`update`. */
  async list(deps: SiteServiceDeps, opts: SiteListOptions): Promise<SiteListPage> {
    return siteRepo.list(deps.db, opts);
  },

  async getById(deps: SiteServiceDeps, id: string): Promise<Site> {
    const row = await siteRepo.getById(deps.db, id);
    if (!row) {
      throw new AppError(`Site not found`, {
        code: 'not_found',
        status: 404,
        details: { id },
      });
    }
    return row;
  },

  /**
   * Create a site, deriving (and de-duplicating) the slug and linking a
   * primary domain row in the same transaction-like sequence.
   *
   * The slug-uniqueness race is benign: a unique index guards the
   * underlying column; if a parallel insert races us, the second `create`
   * will surface a 409 (handled below).
   */
  async create(deps: SiteServiceDeps, input: CreateSiteInput): Promise<Site> {
    const desired = input.slug ?? slugify(input.name);
    const existingSlugs = await siteRepo.slugsLikeBase(deps.db, desired);
    let slug: string;
    try {
      slug = nextAvailableSlug(desired, existingSlugs);
    } catch (err) {
      throw new AppError('Could not pick a unique slug — choose a different name', {
        code: 'conflict',
        status: 409,
        cause: err,
      });
    }

    const insert: NewSite = stripUndefined({
      slug,
      name: input.name,
      primaryUrl: input.primaryUrl,
      siteType: input.siteType,
      status: input.status,
      targetCountry: input.targetCountry,
      targetLanguage: input.targetLanguage,
      techStack: input.techStack,
      repoUrl: input.repoUrl,
      repoProvider: input.repoProvider,
      cfAccountId: input.cfAccountId,
      cfPagesProject: input.cfPagesProject,
      analyticsProvider: input.analyticsProvider,
      analyticsId: input.analyticsId,
      searchConsoleProperty: input.searchConsoleProperty,
      adsensePublisherId: input.adsensePublisherId,
      adsenseStatus: input.adsenseStatus,
      tags: input.tags,
      notes: input.notes,
      healthScore: 100,
    }) as NewSite;

    let created: Site;
    try {
      created = await siteRepo.create(deps.db, insert);
    } catch (err) {
      // postgres-js error codes surface via err.code === '23505' for unique violations.
      const code = (err as { code?: string } | undefined)?.code;
      if (code === '23505') {
        throw new AppError('Slug already in use', {
          code: 'conflict',
          status: 409,
          cause: err,
          details: { slug },
        });
      }
      throw err;
    }

    await linkPrimaryDomain(deps.db, created.id, extractHost(created.primaryUrl));

    deps.logger?.info(
      {
        event: 'site.created',
        siteId: created.id,
        slug: created.slug,
        siteType: created.siteType,
      },
      'site created',
    );
    return created;
  },

  async update(deps: SiteServiceDeps, id: string, patch: UpdateSiteInput): Promise<Site> {
    // Refuse silent slug rewrites for now — the URL exposed in `/sites/{id}` is
    // by id, but slugs feed external integrations (CF, GH) so changing them
    // mid-flight surprises downstream callers. T17/T18 will revisit.
    if (patch.slug !== undefined) {
      throw new AppError('Slug is not editable; archive and create a new site instead', {
        code: 'validation_failed',
        status: 400,
        details: { field: 'slug' },
      });
    }

    // `stripUndefined` removes the keys exactOptionalPropertyTypes would
    // reject, so the cast back to Partial<NewSite> is sound.
    const cleanedPatch = stripUndefined(patch) as Partial<NewSite>;
    const updated = await siteRepo.update(deps.db, id, cleanedPatch);
    if (!updated) {
      throw new AppError('Site not found', {
        code: 'not_found',
        status: 404,
        details: { id },
      });
    }
    deps.logger?.info(
      {
        event: 'site.updated',
        siteId: updated.id,
        fields: Object.keys(cleanedPatch),
      },
      'site updated',
    );
    return updated;
  },

  async archive(deps: SiteServiceDeps, id: string): Promise<Site> {
    const archived = await siteRepo.archive(deps.db, id);
    if (!archived) {
      throw new AppError('Site not found', {
        code: 'not_found',
        status: 404,
        details: { id },
      });
    }
    deps.logger?.info(
      { event: 'site.archived', siteId: archived.id, slug: archived.slug },
      'site archived',
    );
    return archived;
  },
};

export { extractHost };
