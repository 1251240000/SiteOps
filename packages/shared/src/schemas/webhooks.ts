/**
 * Zod schemas for the webhook entry routes.
 *
 * These are deliberately *narrow* — we only validate the fields we read in
 * the dispatcher. Provider payloads carry lots of metadata we don't care
 * about, and we still persist the full body in `webhook_events.payload`.
 */
import { z } from 'zod';

import { WEBHOOK_PROVIDERS } from '../constants/webhooks.js';

/** `?provider=` path param shared by webhook-related routes. */
export const webhookProviderParamSchema = z.enum(WEBHOOK_PROVIDERS);

// ---------------------------------------------------------------------------
// Cloudflare Notification API ("CF Webhooks")
//   text payload as JSON. The exact `name` / `text` schema is documented in
//   https://developers.cloudflare.com/notifications/destinations/webhooks/
//   The subset we currently dispatch on is `deployment.{started,success,failure}`.
// ---------------------------------------------------------------------------

export const cloudflareEventTypeSchema = z.enum([
  'deployment.started',
  'deployment.success',
  'deployment.failure',
]);
export type CloudflareEventType = z.infer<typeof cloudflareEventTypeSchema>;

/**
 * Loose payload shape we extract from CF Pages-flavoured deployment events.
 * Fields here mirror what the user wires up in the CF Notification UI when
 * targeting "Pages: deployment started / succeeded / failed".
 *
 * NOTE: `event_type` lives **outside** the body for Cloudflare — it's read
 * off `cf-webhook-name` or inferred from the body's `text` field.
 */
export const cloudflarePayloadSchema = z
  .object({
    /**
     * Free-form `text` field — CF puts the project name there in their
     * default templates, e.g. `Pages deployment "my-site" succeeded`. We
     * only use it as a *fallback* when the structured fields are missing.
     */
    text: z.string().max(2000).optional(),
    project_name: z.string().max(120).optional(),
    deployment_id: z.string().max(120).optional(),
    commit_hash: z.string().max(64).optional(),
    branch: z.string().max(120).optional(),
    build_log_url: z.string().url().max(2048).optional(),
    /** ISO-8601 timestamps. */
    started_at: z.string().datetime({ offset: true }).optional(),
    finished_at: z.string().datetime({ offset: true }).optional(),
  })
  .passthrough();
export type CloudflarePayload = z.infer<typeof cloudflarePayloadSchema>;

// ---------------------------------------------------------------------------
// GitHub
//   Three event flavours we actually act on. The base schema is intentionally
//   permissive (`.passthrough()`) so future-me can stretch into new fields
//   without rev-bumping the schema.
// ---------------------------------------------------------------------------

export const githubEventTypeSchema = z.enum(['workflow_run', 'push', 'deployment_status', 'ping']);
export type GithubEventType = z.infer<typeof githubEventTypeSchema>;

const githubRepositorySchema = z
  .object({
    full_name: z.string().max(140),
    html_url: z.string().url().max(2048).optional(),
  })
  .passthrough();

export const githubWorkflowRunPayloadSchema = z
  .object({
    action: z.string().max(40).optional(),
    workflow_run: z
      .object({
        id: z.number().int().nonnegative(),
        name: z.string().max(160).optional(),
        head_sha: z.string().max(64),
        head_branch: z.string().max(160).nullable().optional(),
        status: z.string().max(40),
        conclusion: z.string().max(40).nullable().optional(),
        html_url: z.string().url().max(2048).optional(),
        created_at: z.string().datetime({ offset: true }).optional(),
        updated_at: z.string().datetime({ offset: true }).optional(),
        run_started_at: z.string().datetime({ offset: true }).optional(),
      })
      .passthrough(),
    repository: githubRepositorySchema,
  })
  .passthrough();
export type GithubWorkflowRunPayload = z.infer<typeof githubWorkflowRunPayloadSchema>;

export const githubPushPayloadSchema = z
  .object({
    ref: z.string().max(200),
    after: z.string().max(64).optional(),
    repository: githubRepositorySchema,
  })
  .passthrough();
export type GithubPushPayload = z.infer<typeof githubPushPayloadSchema>;

export const githubDeploymentStatusPayloadSchema = z
  .object({
    deployment_status: z
      .object({
        state: z.string().max(40),
        log_url: z.string().url().max(2048).nullable().optional(),
        target_url: z.string().url().max(2048).nullable().optional(),
        environment_url: z.string().url().max(2048).nullable().optional(),
        updated_at: z.string().datetime({ offset: true }).optional(),
      })
      .passthrough(),
    deployment: z
      .object({
        id: z.number().int().nonnegative(),
        sha: z.string().max(64).optional(),
        ref: z.string().max(160).optional(),
      })
      .passthrough(),
    repository: githubRepositorySchema,
  })
  .passthrough();
export type GithubDeploymentStatusPayload = z.infer<typeof githubDeploymentStatusPayloadSchema>;

/** Tiny ping helper — GitHub sends this on initial webhook setup. */
export const githubPingPayloadSchema = z
  .object({
    zen: z.string().max(120).optional(),
    hook_id: z.number().int().nonnegative().optional(),
  })
  .passthrough();
