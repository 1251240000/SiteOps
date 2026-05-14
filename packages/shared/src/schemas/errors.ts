/**
 * Zod schemas for the error-tracking API surface (T15).
 *
 * Upload payload accepts either a single error object or an array (batch).
 * The hot fields (`siteId`, `source`, `level`, `message`) are required; the
 * rest are optional and capped to a sane size to prevent abuse.
 */
import { z } from 'zod';

import { ERROR_LEVELS, ERROR_SOURCES } from '../constants/errors.js';

import { idSchema } from './common.js';

const metaSchema = z
  .record(z.unknown())
  .refine((m) => JSON.stringify(m).length <= 32 * 1024, {
    message: 'meta must be <= 32 KiB when serialised',
  })
  .optional();

export const reportErrorSchema = z.object({
  siteId: idSchema,
  source: z.enum(ERROR_SOURCES),
  level: z.enum(ERROR_LEVELS),
  message: z.string().trim().min(1).max(4096),
  stack: z
    .string()
    .max(16 * 1024)
    .optional(),
  meta: metaSchema,
});
export type ReportErrorInput = z.infer<typeof reportErrorSchema>;

/** A POST body may be a single report or a batch of up to 100 reports. */
export const reportErrorBodySchema = z.union([
  reportErrorSchema,
  z.array(reportErrorSchema).min(1).max(100),
]);
export type ReportErrorBody = z.infer<typeof reportErrorBodySchema>;

export const listErrorsQuerySchema = z.object({
  siteId: idSchema.optional(),
  level: z.enum(ERROR_LEVELS).optional(),
  resolved: z
    .union([z.boolean(), z.enum(['true', 'false']).transform((v) => v === 'true')])
    .optional(),
  q: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type ListErrorsQuery = z.infer<typeof listErrorsQuerySchema>;

export const updateErrorSchema = z
  .object({
    resolved: z.boolean(),
  })
  .strict();
export type UpdateErrorInput = z.infer<typeof updateErrorSchema>;
