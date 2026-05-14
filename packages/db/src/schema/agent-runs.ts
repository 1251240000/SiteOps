import { sql } from 'drizzle-orm';
import { check, index, integer, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';

import { createdAt } from './_helpers.js';
import { apiKeys } from './api-keys.js';

export const AGENT_RUN_STATUS = ['success', 'failed'] as const;
export type AgentRunStatus = (typeof AGENT_RUN_STATUS)[number];

export const agentRuns = pgTable(
  'agent_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    apiKeyId: uuid('api_key_id')
      .notNull()
      .references(() => apiKeys.id),
    agentName: text('agent_name').notNull(),
    action: text('action').notNull(),
    input: jsonb('input').$type<Record<string, unknown>>(),
    output: jsonb('output').$type<Record<string, unknown>>(),
    status: text('status').notNull().$type<AgentRunStatus>(),
    durationMs: integer('duration_ms'),
    createdAt: createdAt(),
  },
  (t) => [
    index('agent_runs_api_key_idx').on(t.apiKeyId),
    index('agent_runs_action_idx').on(t.action),
    check('agent_runs_status_check', sql`${t.status} IN ('success','failed')`),
  ],
);

export type AgentRun = typeof agentRuns.$inferSelect;
export type NewAgentRun = typeof agentRuns.$inferInsert;
