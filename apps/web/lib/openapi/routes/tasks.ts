import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';

import {
  claimTaskSchema,
  completeTaskSchema,
  createTaskSchema,
  failTaskSchema,
  heartbeatTaskSchema,
  listTasksQuerySchema,
  patchTaskSchema,
} from '@siteops/shared';

import {
  idParam,
  jsonResponse,
  looseObject,
  offsetPaginationMeta,
  security,
  standardErrors,
  successEnvelope,
} from '../common';
import { z } from '../extend';

const taskRowSchema = looseObject.openapi('TaskRow');
const idPathParams = z.object({ id: idParam });

export function registerTasks(registry: OpenAPIRegistry): void {
  registry.registerPath({
    method: 'get',
    path: '/tasks',
    tags: ['Tasks'],
    summary: 'List tasks',
    security: security({ cookie: true, apiKey: true, scopes: ['tasks:read'] }),
    request: { query: listTasksQuerySchema },
    responses: {
      200: jsonResponse(
        'Paginated list',
        successEnvelope(z.array(taskRowSchema)).extend({ meta: offsetPaginationMeta }),
      ),
      ...standardErrors({
        unauthorized: true,
        forbidden: true,
        validation: true,
        rateLimited: true,
      }),
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/tasks',
    tags: ['Tasks'],
    summary: 'Enqueue a new task',
    description:
      'Re-POSTing with the same `dedupeKey` while a previous instance is still in-flight is idempotent and surfaces `meta.idempotent=true`.',
    security: security({ cookie: true, apiKey: true, scopes: ['tasks:write'] }),
    request: {
      body: {
        content: { 'application/json': { schema: createTaskSchema.openapi('CreateTaskInput') } },
      },
    },
    responses: {
      201: jsonResponse('Newly created or deduped task', successEnvelope(taskRowSchema)),
      ...standardErrors({
        unauthorized: true,
        forbidden: true,
        validation: true,
        rateLimited: true,
      }),
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/tasks/claim',
    tags: ['Tasks'],
    summary: 'Atomically claim the next available task',
    description:
      'Returns the leased task with a fresh `claimToken`. The caller must save the token and present it on heartbeat / complete / fail.',
    security: security({ apiKey: true, scopes: ['tasks:claim'] }),
    request: {
      body: {
        content: { 'application/json': { schema: claimTaskSchema.openapi('ClaimTaskInput') } },
      },
    },
    responses: {
      200: jsonResponse('Claim outcome', successEnvelope(taskRowSchema.optional())),
      ...standardErrors({
        unauthorized: true,
        forbidden: true,
        validation: true,
        rateLimited: true,
      }),
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/tasks/{id}',
    tags: ['Tasks'],
    summary: 'Get a task by id',
    security: security({ cookie: true, apiKey: true, scopes: ['tasks:read'] }),
    request: { params: idPathParams },
    responses: {
      200: jsonResponse('Task detail', successEnvelope(taskRowSchema)),
      ...standardErrors({ unauthorized: true, forbidden: true, notFound: true, rateLimited: true }),
    },
  });

  registry.registerPath({
    method: 'patch',
    path: '/tasks/{id}',
    tags: ['Tasks'],
    summary: 'Cancel or reschedule a task (admin)',
    security: security({ cookie: true }),
    request: {
      params: idPathParams,
      body: {
        content: { 'application/json': { schema: patchTaskSchema.openapi('PatchTaskInput') } },
      },
    },
    responses: {
      200: jsonResponse('Updated task', successEnvelope(taskRowSchema)),
      ...standardErrors({ unauthorized: true, validation: true, notFound: true }),
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/tasks/{id}/heartbeat',
    tags: ['Tasks'],
    summary: 'Renew the lease on a claimed task',
    security: security({ apiKey: true, scopes: ['tasks:claim'] }),
    request: {
      params: idPathParams,
      body: {
        content: {
          'application/json': { schema: heartbeatTaskSchema.openapi('HeartbeatTaskInput') },
        },
      },
    },
    responses: {
      200: jsonResponse('Refreshed task', successEnvelope(taskRowSchema)),
      ...standardErrors({
        unauthorized: true,
        forbidden: true,
        validation: true,
        notFound: true,
        rateLimited: true,
      }),
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/tasks/{id}/complete',
    tags: ['Tasks'],
    summary: 'Mark a claimed task as completed',
    security: security({ apiKey: true, scopes: ['tasks:claim'] }),
    request: {
      params: idPathParams,
      body: {
        content: {
          'application/json': { schema: completeTaskSchema.openapi('CompleteTaskInput') },
        },
      },
    },
    responses: {
      200: jsonResponse('Completed task', successEnvelope(taskRowSchema)),
      ...standardErrors({
        unauthorized: true,
        forbidden: true,
        validation: true,
        notFound: true,
        rateLimited: true,
      }),
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/tasks/{id}/fail',
    tags: ['Tasks'],
    summary: 'Mark a claimed task as failed (with optional retry)',
    security: security({ apiKey: true, scopes: ['tasks:claim'] }),
    request: {
      params: idPathParams,
      body: {
        content: { 'application/json': { schema: failTaskSchema.openapi('FailTaskInput') } },
      },
    },
    responses: {
      200: jsonResponse('Failed task', successEnvelope(taskRowSchema)),
      ...standardErrors({
        unauthorized: true,
        forbidden: true,
        validation: true,
        notFound: true,
        rateLimited: true,
      }),
    },
  });
}
