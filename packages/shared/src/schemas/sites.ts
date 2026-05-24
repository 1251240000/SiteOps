/**
 * Zod schemas for the site-registry API.
 *
 * Single source of truth: the `apps/web` API routes parse with these
 * schemas, and the dashboard form (`react-hook-form` + `@hookform/resolvers`)
 * reuses the same `createSiteSchema` / `updateSiteSchema`. The shapes here
 * deliberately omit server-derived fields (`id`, `slug`, `health_score`,
 * timestamps) — those are computed by `siteService.create()`.
 */
import { z } from 'zod';

import {
  ADSENSE_STATUS,
  ANALYTICS_PROVIDERS,
  REPO_PROVIDERS,
  SITE_STATUS,
  SITE_TYPES,
} from '../constants/site.js';

import { idSchema, slugSchema, urlSchema } from './common.js';

/**
 * Hostnames we never want a primary URL to point at. The list is
 * deliberately conservative — we additionally reject any private IPv4
 * literal via the `host` regex below. The worker performs full DNS-based
 * SSRF validation in T11 once it actually fetches the URL.
 */
const FORBIDDEN_HOSTS = new Set([
  'localhost',
  '0.0.0.0',
  'broadcasthost',
  'ip6-localhost',
  'ip6-loopback',
]);

const PRIVATE_IPV4_RE = /^(?:127\.|10\.|192\.168\.|169\.254\.|172\.(?:1[6-9]|2\d|3[01])\.)/;

/** Primary URL: https only, public host. */
export const primaryUrlSchema = urlSchema.superRefine((raw, ctx) => {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    ctx.addIssue({ code: 'custom', message: 'must be a valid URL' });
    return;
  }
  if (url.protocol !== 'https:') {
    ctx.addIssue({ code: 'custom', message: 'must use https' });
  }
  const host = url.hostname.toLowerCase();
  if (FORBIDDEN_HOSTS.has(host) || host.endsWith('.localhost') || host.endsWith('.local')) {
    ctx.addIssue({ code: 'custom', message: 'host is not publicly addressable' });
  }
  if (PRIVATE_IPV4_RE.test(host)) {
    ctx.addIssue({ code: 'custom', message: 'host is a private IP range' });
  }
});

export const siteTypeSchema = z.enum(SITE_TYPES);
export const siteStatusSchema = z.enum(SITE_STATUS);
export const repoProviderSchema = z.enum(REPO_PROVIDERS);
export const analyticsProviderSchema = z.enum(ANALYTICS_PROVIDERS);
export const adsenseStatusSchema = z.enum(ADSENSE_STATUS);

export const techStackSchema = z
  .object({
    framework: z.string().max(40).optional(),
    hosting: z.string().max(40).optional(),
    db: z.string().max(40).optional(),
  })
  .strict()
  .optional();

const tagSchema = z
  .string()
  .min(1)
  .max(32)
  .regex(/^[a-z0-9][a-z0-9-]*$/i, { message: 'tags must be alphanumeric / dashes' });

const optionalString = (max: number) =>
  z
    .string()
    .max(max)
    .trim()
    .transform((v) => (v.length === 0 ? undefined : v))
    .optional();

/**
 * Optional URL field whose empty-string form-input value is normalised to
 * `undefined` *before* the URL validator runs. Without this preprocess the
 * `.optional()` wrapper only excuses `undefined` — an empty `<input>` would
 * still flunk `.url()` and surface "must be a valid URL" against a field
 * the operator did not touch.
 */
const optionalUrl = () =>
  z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    urlSchema.optional(),
  );

/** Body shape for `POST /api/v1/sites`. */
export const createSiteSchema = z.object({
  name: z.string().trim().min(1, 'required').max(80),
  primaryUrl: primaryUrlSchema,
  siteType: siteTypeSchema,
  /**
   * Optional explicit slug override. When omitted, the service derives a
   * slug from `name` and ensures uniqueness.
   */
  slug: slugSchema.optional(),
  status: siteStatusSchema.default('active'),
  targetCountry: optionalString(8),
  targetLanguage: optionalString(16),
  techStack: techStackSchema,
  repoUrl: optionalUrl(),
  repoProvider: repoProviderSchema.optional(),
  cfAccountId: optionalString(64),
  cfPagesProject: optionalString(80),
  analyticsProvider: analyticsProviderSchema.optional(),
  analyticsId: optionalString(64),
  searchConsoleProperty: optionalString(255),
  adsensePublisherId: optionalString(40),
  adsenseStatus: adsenseStatusSchema.optional(),
  tags: z.array(tagSchema).max(32).default([]),
  notes: optionalString(2000),
});
export type CreateSiteInput = z.infer<typeof createSiteSchema>;

/** Body shape for `PATCH /api/v1/sites/{id}`. */
export const updateSiteSchema = createSiteSchema.partial();
export type UpdateSiteInput = z.infer<typeof updateSiteSchema>;

/** Filters / sort / pagination for `GET /api/v1/sites`. */
export const listSitesQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  siteType: z.union([siteTypeSchema, z.array(siteTypeSchema)]).optional(),
  status: z.union([siteStatusSchema, z.array(siteStatusSchema)]).optional(),
  country: z.string().trim().max(8).optional(),
  tag: z.string().trim().max(32).optional(),
  /** Show archived rows even when no explicit `status` filter is set. */
  archived: z
    .union([z.boolean(), z.enum(['true', 'false']).transform((v) => v === 'true')])
    .optional()
    .default(false),
  sort: z
    .enum(['created_at', '-created_at', 'health_score', '-health_score', 'name', '-name'])
    .optional()
    .default('-created_at'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type ListSitesQuery = z.infer<typeof listSitesQuerySchema>;

/** Path parameter helper for `/api/v1/sites/{id}`. */
export const siteIdParamSchema = z.object({ id: idSchema });
