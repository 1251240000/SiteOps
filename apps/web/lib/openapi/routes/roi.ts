import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';

import { createSiteCostSchema, updateSiteCostSchema } from '@siteops/shared';

import {
  idParam,
  jsonResponse,
  looseObject,
  security,
  standardErrors,
  successEnvelope,
} from '../common';
import { z } from '../extend';

const costRowSchema = looseObject.openapi('SiteCostRow');
const idPathParams = z.object({ id: idParam });
const costIdPathParams = z.object({ costId: idParam });

const dateRangeQuery = z.object({
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
});

export function registerRoi(registry: OpenAPIRegistry): void {
  registry.registerPath({
    method: 'get',
    path: '/roi/table',
    tags: ['ROI'],
    summary: 'Global ROI table (all sites)',
    description: 'Used by the ROI dashboard to flag low-margin sites.',
    security: security({ cookie: true, apiKey: true, scopes: ['metrics:read'] }),
    request: {
      query: dateRangeQuery.extend({
        sortBy: z.enum(['roi', 'revenue', 'cost', 'name']).default('roi'),
      }),
    },
    responses: {
      200: jsonResponse('ROI rows', successEnvelope(z.array(looseObject))),
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
    path: '/roi/sites/{id}',
    tags: ['ROI'],
    summary: 'Per-site ROI detail',
    security: security({ cookie: true, apiKey: true, scopes: ['metrics:read'] }),
    request: { params: idPathParams, query: dateRangeQuery },
    responses: {
      200: jsonResponse('ROI detail', successEnvelope(looseObject)),
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
    method: 'get',
    path: '/roi/sites/{id}/costs',
    tags: ['ROI'],
    summary: 'List cost rows for a site',
    security: security({ cookie: true, apiKey: true, scopes: ['metrics:read'] }),
    request: { params: idPathParams },
    responses: {
      200: jsonResponse('Cost rows', successEnvelope(z.array(costRowSchema))),
      ...standardErrors({ unauthorized: true, forbidden: true, notFound: true, rateLimited: true }),
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/roi/sites/{id}/costs',
    tags: ['ROI'],
    summary: 'Append a monthly cost row to a site',
    security: security({ cookie: true, apiKey: true, scopes: ['metrics:write'] }),
    request: {
      params: idPathParams,
      body: {
        content: {
          'application/json': { schema: createSiteCostSchema.openapi('CreateSiteCostInput') },
        },
      },
    },
    responses: {
      201: jsonResponse('Created cost row', successEnvelope(costRowSchema)),
      ...standardErrors({
        unauthorized: true,
        forbidden: true,
        validation: true,
        notFound: true,
        conflict: true,
        rateLimited: true,
      }),
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/roi/costs/{costId}',
    tags: ['ROI'],
    summary: 'Get a cost row by id',
    security: security({ cookie: true, apiKey: true, scopes: ['metrics:read'] }),
    request: { params: costIdPathParams },
    responses: {
      200: jsonResponse('Cost row', successEnvelope(costRowSchema)),
      ...standardErrors({ unauthorized: true, forbidden: true, notFound: true, rateLimited: true }),
    },
  });

  registry.registerPath({
    method: 'patch',
    path: '/roi/costs/{costId}',
    tags: ['ROI'],
    summary: 'Update a cost row (partial)',
    security: security({ cookie: true, apiKey: true, scopes: ['metrics:write'] }),
    request: {
      params: costIdPathParams,
      body: {
        content: {
          'application/json': { schema: updateSiteCostSchema.openapi('UpdateSiteCostInput') },
        },
      },
    },
    responses: {
      200: jsonResponse('Updated cost row', successEnvelope(costRowSchema)),
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
    path: '/roi/costs/{costId}',
    tags: ['ROI'],
    summary: 'Delete a cost row',
    security: security({ cookie: true, apiKey: true, scopes: ['metrics:write'] }),
    request: { params: costIdPathParams },
    responses: {
      200: jsonResponse('Deleted cost row', successEnvelope(z.object({ id: z.string().uuid() }))),
      ...standardErrors({ unauthorized: true, forbidden: true, notFound: true, rateLimited: true }),
    },
  });
}
