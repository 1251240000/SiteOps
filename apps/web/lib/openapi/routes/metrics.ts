import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';

import {
  idParam,
  jsonResponse,
  looseObject,
  security,
  standardErrors,
  successEnvelope,
} from '../common';
import { z } from '../extend';

const idPathParams = z.object({ id: idParam });

const dateRangeQuery = z.object({
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
});

export function registerMetrics(registry: OpenAPIRegistry): void {
  registry.registerPath({
    method: 'get',
    path: '/metrics/global/summary',
    tags: ['Metrics'],
    summary: 'Global PV / UV / sessions summary',
    description: 'Returns totals + same-window prior-period delta. Defaults to trailing 30 days.',
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
    path: '/metrics/global/series',
    tags: ['Metrics'],
    summary: 'Global PV / UV / sessions time-series',
    security: security({ cookie: true, apiKey: true, scopes: ['metrics:read'] }),
    request: {
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
        rateLimited: true,
      }),
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/metrics/global/top-sites',
    tags: ['Metrics'],
    summary: 'Top-N sites ranked by traffic metric',
    security: security({ cookie: true, apiKey: true, scopes: ['metrics:read'] }),
    request: {
      query: dateRangeQuery.extend({
        metric: z.enum(['pv', 'uv', 'sessions']).default('pv'),
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
    path: '/metrics/sites/{id}/series',
    tags: ['Metrics'],
    summary: 'Per-site PV / UV time-series',
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
    path: '/metrics/sites/{id}/search',
    tags: ['Metrics'],
    summary: 'Per-site Search Console insights',
    security: security({ cookie: true, apiKey: true, scopes: ['metrics:read'] }),
    request: {
      params: idPathParams,
      query: dateRangeQuery.extend({
        limit: z.coerce.number().int().min(1).max(100).default(20),
      }),
    },
    responses: {
      200: jsonResponse('Search Console rows', successEnvelope(z.array(looseObject))),
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
