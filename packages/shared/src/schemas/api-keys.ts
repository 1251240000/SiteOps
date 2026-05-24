/**
 * Zod schemas for API-key management endpoints.
 */
import { z } from 'zod';

import { API_KEY_SCOPES, API_KEY_WILDCARD } from '../constants/api-keys.js';

const scopeSchema = z.enum([...API_KEY_SCOPES, API_KEY_WILDCARD]);

/**
 * Per-key rate-limit override (T38). NULL = use the env default.
 * Capped at 100_000/min to keep a typo from accidentally disabling
 * throttling in practice; bump the cap if a legitimate workload ever
 * needs more (the DB column has no upper bound).
 */
const rateLimitPerMinSchema = z.number().int().positive().max(100_000);

export const createApiKeySchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    /** Optional ISO timestamp; rejected if in the past. */
    expiresAt: z.string().datetime({ offset: true }).optional(),
    /** Must be a non-empty subset of {API_KEY_SCOPES} ∪ {"*"}.
     *  Wildcard is only valid as the sole entry. */
    scopes: z
      .array(scopeSchema)
      .min(1)
      .max(20)
      .refine(
        (xs) => {
          if (xs.includes(API_KEY_WILDCARD)) return xs.length === 1;
          return new Set(xs).size === xs.length;
        },
        { message: 'wildcard "*" must be the only scope; duplicates not allowed' },
      ),
    /** Optional per-key override of the global `API_KEY_RATE_LIMIT_PER_MIN`. */
    rateLimitPerMin: rateLimitPerMinSchema.optional(),
  })
  .superRefine((v, ctx) => {
    if (v.expiresAt && new Date(v.expiresAt).getTime() <= Date.now()) {
      ctx.addIssue({
        code: 'custom',
        message: 'expiresAt must be in the future',
        path: ['expiresAt'],
      });
    }
  });
export type CreateApiKeyInput = z.infer<typeof createApiKeySchema>;

/**
 * PATCH body for `/settings/api-keys/{id}`. Currently only the rate-limit
 * override is mutable post-creation; everything else (name, scopes, expiry)
 * is locked once issued to keep the audit log meaningful — revoke + reissue
 * if those need to change.
 *
 * `rateLimitPerMin: null` explicitly clears the override (falls back to the
 * env default). Omitting the field is a no-op.
 */
export const updateApiKeySchema = z
  .object({
    rateLimitPerMin: rateLimitPerMinSchema.nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'request body must include at least one mutable field',
  });
export type UpdateApiKeyInput = z.infer<typeof updateApiKeySchema>;

/** Used by both DELETE and GET-by-id route params. */
export const apiKeyIdParamSchema = z.object({
  id: z.string().uuid(),
});
