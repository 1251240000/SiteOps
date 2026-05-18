/**
 * React-Query keys + wire types for the /tasks dashboard.
 */
export type TaskStatus = 'queued' | 'claimed' | 'succeeded' | 'failed' | 'cancelled' | 'expired';

export type TaskRow = {
  id: string;
  kind: string;
  siteId: string | null;
  priority: number;
  payload: Record<string, unknown> | null;
  status: TaskStatus;
  attempts: number;
  maxAttempts: number;
  dedupeKey: string | null;
  availableAt: string;
  claimToken: string | null;
  claimedBy: string | null;
  claimedAt: string | null;
  claimLeaseUntil: string | null;
  finishedAt: string | null;
  lastError: string | null;
  result: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
};

export const tasksKeys = {
  all: ['tasks'] as const,
  lists: () => [...tasksKeys.all, 'list'] as const,
  list: (query: Record<string, unknown>) => [...tasksKeys.lists(), query] as const,
  detail: (id: string) => [...tasksKeys.all, 'detail', id] as const,
};
