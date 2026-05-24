/**
 * Zod schemas for the agent-runs read API.
 *
 * The write side is generated transparently by the `withApiKeyAudited`
 * wrapper inside `apps/web/lib/with-api.ts`, so no client-facing input
 * schema is exposed here.
 */
import { z } from 'zod';

import { AGENT_RUN_STATUS } from '../constants/agent-runs.js';
import { idSchema, isoDateSchema } from './common.js';

export const agentRunStatusSchema = z.enum(AGENT_RUN_STATUS);

export const listAgentRunsQuerySchema = z.object({
  apiKeyId: idSchema.optional(),
  agentName: z.string().trim().min(1).max(120).optional(),
  /**
   * Free-text action filter. Trailing `.*` (e.g. `tasks.*`) maps to a
   * SQL `LIKE 'tasks.%'`; otherwise an exact match. Bare `*` is rejected
   * to avoid full-table scans masquerading as a filter.
   */
  action: z.string().trim().min(1).max(120).optional(),
  status: agentRunStatusSchema.optional(),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  sort: z.enum(['-created_at', 'created_at']).default('-created_at'),
  /**
   * Opaque base64url keyset cursor. When set, the route ignores `page` and
   * switches to keyset pagination — meta becomes `{ cursor: { next? }, hasMore }`.
   */
  cursor: z.string().min(1).max(512).optional(),
});
export type ListAgentRunsQuery = z.infer<typeof listAgentRunsQuerySchema>;

export const agentRunIdParamSchema = z.object({ id: idSchema });

export const agentRunSummaryQuerySchema = z
  .object({
    from: isoDateSchema.optional(),
    to: isoDateSchema.optional(),
  })
  .refine(
    (v) => {
      if (!v.from || !v.to) return true;
      return new Date(v.from).getTime() <= new Date(v.to).getTime();
    },
    { message: '`from` must be <= `to`', path: ['from'] },
  );
export type AgentRunSummaryQuery = z.infer<typeof agentRunSummaryQuerySchema>;
