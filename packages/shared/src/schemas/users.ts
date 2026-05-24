import { z } from 'zod';

import { USER_ROLES, USER_STATUSES } from '../constants/users.js';

/** UUID param shape used by `/api/v1/users/:id` routes. */
export const userIdParamSchema = z.object({
  id: z.string().uuid(),
});

/** POST /api/v1/users/invitations — admin creates an invite. */
export const createInvitationSchema = z.object({
  email: z.string().email().max(254),
  role: z.enum(USER_ROLES).default('viewer'),
});
export type CreateInvitationInput = z.infer<typeof createInvitationSchema>;

/** POST /api/v1/users/invitations/accept — public, set password. */
export const acceptInvitationSchema = z.object({
  token: z.string().min(1).max(256),
  name: z.string().min(1).max(128),
  password: z.string().min(8).max(1024),
});
export type AcceptInvitationInput = z.infer<typeof acceptInvitationSchema>;

/** PATCH /api/v1/users/:id — admin updates role/status. */
export const updateUserSchema = z
  .object({
    role: z.enum(USER_ROLES).optional(),
    status: z.enum(USER_STATUSES).optional(),
  })
  .refine((d) => d.role !== undefined || d.status !== undefined, {
    message: 'At least one of role or status must be provided',
  });
export type UpdateUserInput = z.infer<typeof updateUserSchema>;

/** GET /api/v1/users query params. */
export const listUsersQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  status: z.enum(USER_STATUSES).optional(),
  role: z.enum(USER_ROLES).optional(),
});
export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;
