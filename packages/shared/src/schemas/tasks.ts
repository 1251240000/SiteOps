/**
 * Zod schemas for the Task Queue REST API.
 *
 * Wire shapes mirror `tasks/T25-task-queue-api.md`. Internal-only fields
 * (`claimToken`, `attempts`, `availableAt`) are derived server-side and never
 * accepted from clients on `POST /tasks`.
 */
import { z } from 'zod';

import {
  TASK_DEDUPE_KEY_MAX_LENGTH,
  TASK_DEFAULT_MAX_ATTEMPTS,
  TASK_KIND_MAX_LENGTH,
  TASK_KIND_REGEX,
  TASK_LEASE_SECONDS_DEFAULT,
  TASK_LEASE_SECONDS_MAX,
  TASK_LEASE_SECONDS_MIN,
  TASK_MAX_ATTEMPTS_MAX,
  TASK_MAX_ATTEMPTS_MIN,
  TASK_PRIORITY_MAX,
  TASK_PRIORITY_MIN,
  TASK_STATUS,
} from '../constants/tasks.js';
import { idSchema, isoDateSchema } from './common.js';

export const taskStatusSchema = z.enum(TASK_STATUS);

export const taskKindSchema = z.string().min(1).max(TASK_KIND_MAX_LENGTH).regex(TASK_KIND_REGEX, {
  message: 'must be lowercase a-z0-9 with `._-` separators (e.g. `content.draft`)',
});

const taskPayloadSchema = z.record(z.unknown()).default({});

export const createTaskSchema = z.object({
  kind: taskKindSchema,
  siteId: idSchema.optional(),
  priority: z.number().int().min(TASK_PRIORITY_MIN).max(TASK_PRIORITY_MAX).default(0),
  payload: taskPayloadSchema,
  maxAttempts: z
    .number()
    .int()
    .min(TASK_MAX_ATTEMPTS_MIN)
    .max(TASK_MAX_ATTEMPTS_MAX)
    .default(TASK_DEFAULT_MAX_ATTEMPTS),
  /** Optional idempotency hint. Re-POSTs with the same key return the existing row. */
  dedupeKey: z.string().min(1).max(TASK_DEDUPE_KEY_MAX_LENGTH).optional(),
  /** Schedule for the future. Defaults to "now" server-side. */
  availableAt: isoDateSchema.optional(),
});
export type CreateTaskInput = z.infer<typeof createTaskSchema>;

export const claimTaskSchema = z.object({
  /** Optional whitelist of kinds the agent will pull. Empty/undefined = any kind. */
  kinds: z.array(taskKindSchema).max(20).optional(),
  leaseSeconds: z
    .number()
    .int()
    .min(TASK_LEASE_SECONDS_MIN)
    .max(TASK_LEASE_SECONDS_MAX)
    .default(TASK_LEASE_SECONDS_DEFAULT),
});
export type ClaimTaskInput = z.infer<typeof claimTaskSchema>;

export const heartbeatTaskSchema = z.object({
  claimToken: z.string().min(1),
  leaseSeconds: z
    .number()
    .int()
    .min(TASK_LEASE_SECONDS_MIN)
    .max(TASK_LEASE_SECONDS_MAX)
    .default(TASK_LEASE_SECONDS_DEFAULT),
});
export type HeartbeatTaskInput = z.infer<typeof heartbeatTaskSchema>;

export const completeTaskSchema = z.object({
  claimToken: z.string().min(1),
  result: z.record(z.unknown()).optional(),
});
export type CompleteTaskInput = z.infer<typeof completeTaskSchema>;

export const failTaskSchema = z.object({
  claimToken: z.string().min(1),
  error: z.string().min(1).max(2000),
  /** When `false`, force the task into terminal `failed` regardless of attempts left. */
  retry: z.boolean().default(true),
});
export type FailTaskInput = z.infer<typeof failTaskSchema>;

export const listTasksQuerySchema = z.object({
  status: z.union([taskStatusSchema, z.array(taskStatusSchema)]).optional(),
  kind: z.union([taskKindSchema, z.array(taskKindSchema)]).optional(),
  siteId: idSchema.optional(),
  /** Free-text search over `kind` + `last_error`. */
  q: z.string().trim().max(200).optional(),
  sort: z
    .enum(['created_at', '-created_at', 'available_at', '-available_at', 'priority', '-priority'])
    .default('-created_at'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type ListTasksQuery = z.infer<typeof listTasksQuerySchema>;

/**
 * Admin-only patch shape. Used to cancel (`status=cancelled`) or reschedule
 * (`availableAt`) a task from the dashboard. Other fields are immutable.
 */
export const patchTaskSchema = z
  .object({
    status: z.enum(['cancelled']).optional(),
    availableAt: isoDateSchema.optional(),
    priority: z.number().int().min(TASK_PRIORITY_MIN).max(TASK_PRIORITY_MAX).optional(),
  })
  .refine(
    (v) => v.status !== undefined || v.availableAt !== undefined || v.priority !== undefined,
    {
      message: 'at least one of status, availableAt, priority is required',
    },
  );
export type PatchTaskInput = z.infer<typeof patchTaskSchema>;

export const taskIdParamSchema = z.object({ id: idSchema });
