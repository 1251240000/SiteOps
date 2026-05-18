/**
 * React-Query keys + wire types for the agent-runs dashboard.
 *
 * Wire types intentionally mirror the API response shape, not the DB types,
 * because dates come back as ISO strings over the network.
 */

export type AgentRunStatus = 'success' | 'failed';

export type AgentRunListRow = {
  id: string;
  apiKeyId: string;
  apiKey: { id: string; name: string } | null;
  agentName: string;
  action: string;
  status: AgentRunStatus;
  durationMs: number | null;
  createdAt: string;
};

export type AgentRunDetail = AgentRunListRow & {
  input: Record<string, unknown> | null;
  output: Record<string, unknown> | null;
};

export type AgentRunSummary = {
  total: number;
  succeeded: number;
  failed: number;
  p50DurationMs: number | null;
  p95DurationMs: number | null;
  activeKeys: number;
};

export type AgentRunsListMeta = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

export const agentRunsKeys = {
  all: ['agent-runs'] as const,
  lists: () => [...agentRunsKeys.all, 'list'] as const,
  list: (query: Record<string, unknown>) => [...agentRunsKeys.lists(), query] as const,
  details: () => [...agentRunsKeys.all, 'detail'] as const,
  detail: (id: string) => [...agentRunsKeys.details(), id] as const,
  summary: (query: Record<string, unknown>) => [...agentRunsKeys.all, 'summary', query] as const,
};
