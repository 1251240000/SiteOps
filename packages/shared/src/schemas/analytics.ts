import { z } from 'zod';

import { isoDateSchema } from './common.js';

export const analyticsEventTypeSchema = z.enum(['pageview', 'event', 'web_vital', 'identify']);

const FORBIDDEN_PROPERTY_KEYS =
  /(^|[_-])(email|phone|password|token|secret|cookie|authorization)($|[_-])/i;
const MAX_PROPERTIES_BYTES = 8 * 1024;
const MAX_EVENTS_PER_BATCH = 50;

const jsonValueSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(jsonValueSchema),
  ]),
);

function hasForbiddenKey(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some(hasForbiddenKey);
  return Object.entries(value as Record<string, unknown>).some(
    ([key, child]) => FORBIDDEN_PROPERTY_KEYS.test(key) || hasForbiddenKey(child),
  );
}

function jsonByteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value ?? {})).byteLength;
}

export const analyticsPropertiesSchema = z
  .record(jsonValueSchema)
  .default({})
  .superRefine((value, ctx) => {
    if (hasForbiddenKey(value)) {
      ctx.addIssue({ code: 'custom', message: 'properties must not contain PII-like keys' });
    }
    if (jsonByteLength(value) > MAX_PROPERTIES_BYTES) {
      ctx.addIssue({ code: 'custom', message: 'properties must be <= 8 KiB' });
    }
  });

export const collectEventSchema = z.object({
  type: analyticsEventTypeSchema,
  name: z.string().trim().min(1).max(120),
  ts: isoDateSchema,
  path: z.string().max(2048).optional(),
  url: z.string().url().max(4096).optional(),
  referrer: z.string().max(4096).optional(),
  properties: analyticsPropertiesSchema.optional(),
});
export type CollectEvent = z.infer<typeof collectEventSchema>;

export const collectPayloadSchema = z.object({
  siteKey: z.string().regex(/^site_pk_[a-zA-Z0-9_-]{3,}$/),
  sentAt: isoDateSchema,
  visitorId: z.string().trim().min(1).max(128),
  sessionId: z.string().trim().min(1).max(128),
  events: z.array(collectEventSchema).min(1).max(MAX_EVENTS_PER_BATCH),
});
export type CollectPayload = z.infer<typeof collectPayloadSchema>;

export const analyticsQuerySchema = z.object({
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

export const ANALYTICS_LIMITS = {
  maxEventsPerBatch: MAX_EVENTS_PER_BATCH,
  maxPropertiesBytes: MAX_PROPERTIES_BYTES,
} as const;
