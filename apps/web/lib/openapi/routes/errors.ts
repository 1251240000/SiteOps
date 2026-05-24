import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';

import { listErrorsQuerySchema, reportErrorBodySchema, updateErrorSchema } from '@siteops/shared';

import {
  cursorPaginationMeta,
  idParam,
  jsonResponse,
  looseObject,
  offsetPaginationMeta,
  security,
  standardErrors,
  successEnvelope,
} from '../common';
import { z } from '../extend';

const errorRowSchema = looseObject.openapi('ErrorRow');
const idPathParams = z.object({ id: idParam });

export function registerErrors(registry: OpenAPIRegistry): void {
  registry.registerPath({
    method: 'get',
    path: '/errors',
    tags: ['Errors'],
    summary: 'List error events',
    description: 'Supports both `?page=N` offset and `?cursor=...` keyset pagination (T36).',
    security: security({ cookie: true, apiKey: true, scopes: ['errors:read'] }),
    request: { query: listErrorsQuerySchema },
    responses: {
      200: jsonResponse(
        'Paginated list. Meta is `OffsetPaginationMeta` when `page` is used, `CursorPaginationMeta` when `cursor` is used.',
        successEnvelope(z.array(errorRowSchema)).extend({
          meta: z.union([offsetPaginationMeta, cursorPaginationMeta]),
        }),
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
    path: '/errors',
    tags: ['Errors'],
    summary: 'Report a single error or batch',
    description:
      'Used by site-side SDKs. Accepts either a single report or an array (max 100 items).',
    security: security({ apiKey: true, scopes: ['errors:write'] }),
    request: {
      body: {
        content: {
          'application/json': { schema: reportErrorBodySchema.openapi('ReportErrorBody') },
        },
      },
    },
    responses: {
      201: jsonResponse(
        'Persisted rows (one per report)',
        successEnvelope(z.array(errorRowSchema)),
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
    method: 'get',
    path: '/errors/{id}',
    tags: ['Errors'],
    summary: 'Get an error event by id',
    security: security({ cookie: true, apiKey: true, scopes: ['errors:read'] }),
    request: { params: idPathParams },
    responses: {
      200: jsonResponse('Error detail', successEnvelope(errorRowSchema)),
      ...standardErrors({ unauthorized: true, forbidden: true, notFound: true, rateLimited: true }),
    },
  });

  registry.registerPath({
    method: 'patch',
    path: '/errors/{id}',
    tags: ['Errors'],
    summary: 'Mark an error as resolved / unresolved',
    security: security({ cookie: true, apiKey: true, scopes: ['errors:write'] }),
    request: {
      params: idPathParams,
      body: {
        content: { 'application/json': { schema: updateErrorSchema.openapi('UpdateErrorInput') } },
      },
    },
    responses: {
      200: jsonResponse('Updated row', successEnvelope(errorRowSchema)),
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
    method: 'delete',
    path: '/errors/{id}',
    tags: ['Errors'],
    summary: 'Delete an error event row',
    security: security({ cookie: true, apiKey: true, scopes: ['errors:write'] }),
    request: { params: idPathParams },
    responses: {
      200: jsonResponse('Deleted row', successEnvelope(errorRowSchema)),
      ...standardErrors({ unauthorized: true, forbidden: true, notFound: true, rateLimited: true }),
    },
  });
}
