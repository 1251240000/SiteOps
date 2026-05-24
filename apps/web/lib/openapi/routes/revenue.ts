import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';

import { createAffiliateEntrySchema, updateAffiliateEntrySchema } from '@siteops/shared';

import {
  idParam,
  jsonResponse,
  looseObject,
  security,
  standardErrors,
  successEnvelope,
} from '../common';
import { z } from '../extend';

const affiliateRowSchema = looseObject.openapi('AffiliateEntryRow');
const idPathParams = z.object({ id: idParam });
const entryIdPathParams = z.object({ entryId: idParam });

const dateRangeQuery = z.object({
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
});

export function registerRevenue(registry: OpenAPIRegistry): void {
  registry.registerPath({
    method: 'get',
    path: '/revenue/global/summary',
    tags: ['Revenue'],
    summary: 'Global revenue summary (Ads + Affiliate)',
    security: security({ cookie: true, apiKey: true, scopes: ['metrics:read'] }),
    request: { query: dateRangeQuery },
    responses: {
      200: jsonResponse('Summary', successEnvelope(looseObject)),
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
    path: '/revenue/global/series',
    tags: ['Revenue'],
    summary: 'Global revenue time-series',
    security: security({ cookie: true, apiKey: true, scopes: ['metrics:read'] }),
    request: { query: dateRangeQuery },
    responses: {
      200: jsonResponse('Series', successEnvelope(z.array(looseObject))),
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
    path: '/revenue/global/top-sites',
    tags: ['Revenue'],
    summary: 'Top-N sites ranked by total revenue',
    security: security({ cookie: true, apiKey: true, scopes: ['metrics:read'] }),
    request: {
      query: dateRangeQuery.extend({
        limit: z.coerce.number().int().min(1).max(100).default(10),
      }),
    },
    responses: {
      200: jsonResponse('Top sites', successEnvelope(z.array(looseObject))),
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
    path: '/revenue/sites/{id}/series',
    tags: ['Revenue'],
    summary: 'Per-site revenue time-series',
    security: security({ cookie: true, apiKey: true, scopes: ['metrics:read'] }),
    request: {
      params: idPathParams,
      query: dateRangeQuery.extend({
        granularity: z.enum(['day', 'week']).default('day'),
      }),
    },
    responses: {
      200: jsonResponse('Series', successEnvelope(z.array(looseObject))),
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
    path: '/revenue/sites/{id}/affiliate-entries',
    tags: ['Revenue'],
    summary: 'List affiliate entries for a site',
    security: security({ cookie: true, apiKey: true, scopes: ['metrics:read'] }),
    request: { params: idPathParams },
    responses: {
      200: jsonResponse('Affiliate rows', successEnvelope(z.array(affiliateRowSchema))),
      ...standardErrors({
        unauthorized: true,
        forbidden: true,
        notFound: true,
        rateLimited: true,
      }),
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/revenue/sites/{id}/affiliate-entries',
    tags: ['Revenue'],
    summary: 'Create an affiliate entry for a site',
    security: security({ cookie: true, apiKey: true, scopes: ['metrics:write'] }),
    request: {
      params: idPathParams,
      body: {
        content: {
          'application/json': {
            schema: createAffiliateEntrySchema.openapi('CreateAffiliateEntryInput'),
          },
        },
      },
    },
    responses: {
      201: jsonResponse('Created entry', successEnvelope(affiliateRowSchema)),
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
    path: '/revenue/affiliate-entries/{entryId}',
    tags: ['Revenue'],
    summary: 'Get an affiliate entry by id',
    security: security({ cookie: true, apiKey: true, scopes: ['metrics:read'] }),
    request: { params: entryIdPathParams },
    responses: {
      200: jsonResponse('Affiliate row', successEnvelope(affiliateRowSchema)),
      ...standardErrors({ unauthorized: true, forbidden: true, notFound: true, rateLimited: true }),
    },
  });

  registry.registerPath({
    method: 'patch',
    path: '/revenue/affiliate-entries/{entryId}',
    tags: ['Revenue'],
    summary: 'Update an affiliate entry (partial)',
    security: security({ cookie: true, apiKey: true, scopes: ['metrics:write'] }),
    request: {
      params: entryIdPathParams,
      body: {
        content: {
          'application/json': {
            schema: updateAffiliateEntrySchema.openapi('UpdateAffiliateEntryInput'),
          },
        },
      },
    },
    responses: {
      200: jsonResponse('Updated entry', successEnvelope(affiliateRowSchema)),
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
    path: '/revenue/affiliate-entries/{entryId}',
    tags: ['Revenue'],
    summary: 'Delete an affiliate entry',
    security: security({ cookie: true, apiKey: true, scopes: ['metrics:write'] }),
    request: { params: entryIdPathParams },
    responses: {
      200: jsonResponse('Deleted entry', successEnvelope(affiliateRowSchema)),
      ...standardErrors({ unauthorized: true, forbidden: true, notFound: true, rateLimited: true }),
    },
  });
}
