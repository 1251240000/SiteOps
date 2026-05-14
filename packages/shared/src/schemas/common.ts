import { z } from 'zod';

/** RFC 4122 UUID (any version). Drizzle issues v4 via `gen_random_uuid()`. */
export const idSchema = z.string().uuid({ message: 'must be a valid UUID' });

/**
 * URL with explicit http/https scheme. SSRF-sensitive callers (uptime check
 * targets, webhook destinations) must additionally pass `assertNoPrivateHost`
 * — that policy lives in the worker package since it depends on `node:net`.
 */
export const urlSchema = z
  .string()
  .url({ message: 'must be a valid URL' })
  .refine((v) => /^https?:\/\//i.test(v), {
    message: 'must use http or https',
  });

export const isoDateSchema = z
  .string()
  .datetime({ offset: true, message: 'must be ISO-8601 with timezone' });

/** Lowercased kebab-case slug, 1–64 chars; ^[a-z0-9](-[a-z0-9]+)*$. */
export const slugSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: 'must be lowercase kebab-case',
  });

/** Inclusive ISO date range; validates `from <= to`. */
export const dateRangeSchema = z
  .object({
    from: isoDateSchema,
    to: isoDateSchema,
  })
  .refine((v) => new Date(v.from).getTime() <= new Date(v.to).getTime(), {
    message: '`from` must be <= `to`',
    path: ['from'],
  });

export type DateRange = z.infer<typeof dateRangeSchema>;
