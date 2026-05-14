/**
 * Minimal type definitions for the subset of the Cloudflare REST API used by
 * T17 (Pages projects + deployments).
 *
 * We deliberately do not import any official `@cloudflare/*` SDK — its
 * surface area dwarfs what we consume and pulling it in would balloon the
 * worker bundle. Hand-rolled types here keep tests and lints fast.
 *
 * Refs:
 *   - https://developers.cloudflare.com/api/operations/pages-project-get-projects
 *   - https://developers.cloudflare.com/api/operations/pages-deployment-get-deployments
 */

export type CfApiEnvelope<T> = {
  success: boolean;
  errors: Array<{ code: number; message: string }>;
  messages: unknown[];
  result: T;
  result_info?: {
    page?: number;
    per_page?: number;
    count?: number;
    total_count?: number;
    total_pages?: number;
  };
};

export type CfPagesProject = {
  id: string;
  name: string;
  subdomain?: string;
  domains: string[];
  source?: { type?: string; config?: Record<string, unknown> };
  latest_deployment?: CfPagesDeployment | null;
  created_on: string;
  production_branch?: string;
};

export type CfPagesDeploymentStage = {
  name: string;
  status: string;
  started_on?: string | null;
  ended_on?: string | null;
};

export type CfPagesDeployment = {
  id: string;
  short_id?: string;
  project_id?: string;
  project_name: string;
  environment: 'production' | 'preview';
  url?: string;
  /** "queued" | "active" | "success" | "failure" | "skipped" | "canceled" */
  latest_stage?: CfPagesDeploymentStage;
  stages?: CfPagesDeploymentStage[];
  deployment_trigger?: {
    type?: string;
    metadata?: {
      branch?: string;
      commit_hash?: string;
      commit_message?: string;
    };
  };
  source?: {
    type?: string;
    config?: { production_branch?: string };
  };
  created_on: string;
  modified_on?: string;
  /** Some payloads include this convenience block when the deploy finished. */
  build_config?: Record<string, unknown>;
};

export type CfTokenVerification = {
  id: string;
  status: 'active' | 'disabled' | 'expired';
  not_before?: string;
  expires_on?: string;
};
