/**
 * Zod schemas for the domain API.
 *
 * Note the `domain` field auto-normalises (lowercase, scheme/port/path
 * stripped) so the dashboard form can be lenient about what the user
 * pastes and the DB still gets a canonical string for the unique index.
 */
import { z } from 'zod';

import { isValidDomain, normalizeDomain } from '../utils/domain.js';

import { idSchema } from './common.js';

const domainStringSchema = z
  .string()
  .min(1, 'required')
  .max(255)
  .transform((v) => normalizeDomain(v))
  .refine((v) => isValidDomain(v), { message: 'invalid domain' });

/**
 * ISO `YYYY-MM-DD` date string (no time portion). Matches the Drizzle
 * `date({ mode: 'string' })` column type.
 */
const isoDateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'must be YYYY-MM-DD' });

/** `null` clears, `undefined` leaves field untouched. */
const nullableDateOnly = z.union([isoDateOnly, z.null()]);

const optionalText = (max: number) =>
  z
    .string()
    .max(max)
    .trim()
    .transform((v) => (v.length === 0 ? undefined : v))
    .optional();

export const createDomainSchema = z.object({
  siteId: idSchema,
  domain: domainStringSchema,
  isPrimary: z.boolean().default(false),
  registrar: optionalText(80),
  registeredAt: isoDateOnly.optional(),
  expiresAt: isoDateOnly.optional(),
  autoRenew: z.boolean().optional(),
  dnsProvider: optionalText(80),
});
export type CreateDomainInput = z.infer<typeof createDomainSchema>;

export const updateDomainSchema = z
  .object({
    domain: domainStringSchema.optional(),
    isPrimary: z.boolean().optional(),
    registrar: z.union([z.string().max(80), z.null()]).optional(),
    registeredAt: nullableDateOnly.optional(),
    expiresAt: nullableDateOnly.optional(),
    autoRenew: z.union([z.boolean(), z.null()]).optional(),
    dnsProvider: z.union([z.string().max(80), z.null()]).optional(),
  })
  .strict();
export type UpdateDomainInput = z.infer<typeof updateDomainSchema>;

export const listDomainsQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  siteId: idSchema.optional(),
  expiringWithinDays: z.coerce.number().int().min(1).max(3650).optional(),
  sort: z.enum(['expires_at', '-expires_at', 'domain', '-domain']).default('expires_at'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type ListDomainsQuery = z.infer<typeof listDomainsQuerySchema>;

export const domainIdParamSchema = z.object({ id: idSchema });
