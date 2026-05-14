/**
 * Minimal GitHub REST type definitions. We only model the fields T18 reads.
 */

export type GhWorkflowRunStatus =
  | 'queued'
  | 'in_progress'
  | 'requested'
  | 'waiting'
  | 'pending'
  | 'completed';

export type GhWorkflowRunConclusion =
  | null
  | 'success'
  | 'failure'
  | 'neutral'
  | 'cancelled'
  | 'skipped'
  | 'timed_out'
  | 'action_required'
  | 'startup_failure'
  | 'stale';

export type GhWorkflowRun = {
  id: number;
  name?: string | null;
  display_title?: string | null;
  head_branch?: string | null;
  head_sha: string;
  path?: string;
  run_number?: number;
  event?: string;
  status: GhWorkflowRunStatus;
  conclusion: GhWorkflowRunConclusion;
  workflow_id?: number;
  url?: string;
  html_url: string;
  created_at: string;
  updated_at: string;
  run_started_at?: string | null;
  head_commit?: {
    id: string;
    message?: string;
    author?: { name?: string; email?: string };
  } | null;
};

export type GhWorkflowRunListEnvelope = {
  total_count: number;
  workflow_runs: GhWorkflowRun[];
};

export type GhCommitEnvelope = {
  sha: string;
  commit: {
    message: string;
    author?: { name?: string; email?: string; date?: string };
  };
  html_url: string;
};

export type GhRateLimit = {
  limit: number;
  remaining: number;
  reset: number; // epoch seconds
};
