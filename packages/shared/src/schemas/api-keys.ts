/**
 * Zod schemas for API-key management endpoints.
 */
import { z } from 'zod';

import { API_KEY_SCOPES, API_KEY_WILDCARD } from '../constants/api-keys.js';

const scopeSchema = z.enum([...API_KEY_SCOPES, API_KEY_WILDCARD]);

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

/** Used by both DELETE and GET-by-id route params. */
export const apiKeyIdParamSchema = z.object({
  id: z.string().uuid(),
});
