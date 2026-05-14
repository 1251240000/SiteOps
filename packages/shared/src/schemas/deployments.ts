/**
 * Zod schemas for the deployment API.
 *
 * The create payload must carry either a `(provider, providerDeploymentId)`
 * pair (so the DB unique index can dedupe upstream webhook retries) or a
 * `commitSha` (so manual entries from a human still have something
 * meaningful to display). Other combinations are accepted but the
 * service layer will refuse to insert a row with no identity at all.
 */
import { z } from 'zod';

import {
  DEPLOYMENT_PROVIDERS,
  DEPLOYMENT_STATUS,
  DEPLOYMENT_TRIGGERS,
} from '../constants/deployments.js';
import { idSchema, isoDateSchema } from './common.js';

const optionalText = (max: number) =>
  z
    .string()
    .max(max)
    .trim()
    .transform((v) => (v.length === 0 ? undefined : v))
    .optional();

export const deploymentProviderSchema = z.enum(DEPLOYMENT_PROVIDERS);
export const deploymentStatusSchema = z.enum(DEPLOYMENT_STATUS);
export const deploymentTriggerSchema = z.enum(DEPLOYMENT_TRIGGERS);

export const createDeploymentSchema = z
  .object({
    siteId: idSchema,
    provider: deploymentProviderSchema.optional(),
    providerDeploymentId: optionalText(120),
    commitSha: optionalText(64),
    commitMessage: optionalText(2000),
    branch: optionalText(120),
    status: deploymentStatusSchema,
    startedAt: isoDateSchema.optional(),
    finishedAt: isoDateSchema.optional(),
    buildLogUrl: z.string().url().max(2048).optional(),
    triggeredBy: deploymentTriggerSchema.optional(),
  })
  .superRefine((v, ctx) => {
    const hasProviderPair =
      v.provider !== undefined &&
      v.providerDeploymentId !== undefined &&
      v.providerDeploymentId.length > 0;
    const hasCommit = v.commitSha !== undefined && v.commitSha.length > 0;
    if (!hasProviderPair && !hasCommit) {
      ctx.addIssue({
        code: 'custom',
        message:
          'Provide either (provider + providerDeploymentId) for webhooks or commitSha for manual entries',
        path: ['providerDeploymentId'],
      });
    }
    if (v.startedAt && v.finishedAt) {
      if (new Date(v.finishedAt).getTime() < new Date(v.startedAt).getTime()) {
        ctx.addIssue({
          code: 'custom',
          message: 'finishedAt must be >= startedAt',
          path: ['finishedAt'],
        });
      }
    }
  });
export type CreateDeploymentInput = z.infer<typeof createDeploymentSchema>;

export const listDeploymentsQuerySchema = z.object({
  siteId: idSchema.optional(),
  status: z.union([deploymentStatusSchema, z.array(deploymentStatusSchema)]).optional(),
  provider: z.union([deploymentProviderSchema, z.array(deploymentProviderSchema)]).optional(),
  /** Free-text search over commitSha + commitMessage + branch. */
  q: z.string().trim().max(200).optional(),
  sort: z.enum(['started_at', '-started_at', 'created_at', '-created_at']).default('-started_at'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type ListDeploymentsQuery = z.infer<typeof listDeploymentsQuerySchema>;

export const deploymentIdParamSchema = z.object({ id: idSchema });
