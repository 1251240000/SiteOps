import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';

import { createSiteSchema, listSitesQuerySchema, updateSiteSchema } from '@siteops/shared';

import {
  cursorPaginationMeta,
  idParam,
  jsonResponse,
  looseArray,
  looseObject,
  offsetPaginationMeta,
  security,
  standardErrors,
  successEnvelope,
} from '../common';
import { z } from '../extend';

const siteRowSchema = looseObject.openapi('SiteRow');
const createSiteOpenApi = createSiteSchema.openapi('CreateSiteInput');
const updateSiteOpenApi = updateSiteSchema.openapi('UpdateSiteInput');
const listSitesQueryOpenApi = listSitesQuerySchema;
const idPathParams = z.object({ id: idParam });

export function registerSites(registry: OpenAPIRegistry): void {
  registry.registerPath({
    method: 'get',
    path: '/sites',
    tags: ['Sites'],
    summary: 'List sites',
    description: 'Filters / sort / pagination per `listSitesQuerySchema`.',
    security: security({ cookie: true, apiKey: true, scopes: ['sites:read'] }),
    request: { query: listSitesQueryOpenApi },
    responses: {
      200: jsonResponse(
        'Paginated list',
        successEnvelope(z.array(siteRowSchema)).extend({ meta: offsetPaginationMeta }),
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
    path: '/sites',
    tags: ['Sites'],
    summary: 'Create a site',
    security: security({ cookie: true, apiKey: true, scopes: ['sites:write'] }),
    request: { body: { content: { 'application/json': { schema: createSiteOpenApi } } } },
    responses: {
      201: jsonResponse('Created site', successEnvelope(siteRowSchema)),
      ...standardErrors({
        unauthorized: true,
        forbidden: true,
        validation: true,
        conflict: true,
        rateLimited: true,
      }),
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/sites/{id}',
    tags: ['Sites'],
    summary: 'Get a site by id',
    security: security({ cookie: true, apiKey: true, scopes: ['sites:read'] }),
    request: { params: idPathParams },
    responses: {
      200: jsonResponse('Site detail', successEnvelope(siteRowSchema)),
      ...standardErrors({ unauthorized: true, forbidden: true, notFound: true, rateLimited: true }),
    },
  });

  registry.registerPath({
    method: 'patch',
    path: '/sites/{id}',
    tags: ['Sites'],
    summary: 'Update a site (partial)',
    security: security({ cookie: true, apiKey: true, scopes: ['sites:write'] }),
    request: {
      params: idPathParams,
      body: { content: { 'application/json': { schema: updateSiteOpenApi } } },
    },
    responses: {
      200: jsonResponse('Updated site', successEnvelope(siteRowSchema)),
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
    path: '/sites/{id}',
    tags: ['Sites'],
    summary: 'Archive a site',
    description: 'Soft delete: sets `status=archived`. Use a PATCH to revive.',
    security: security({ cookie: true, apiKey: true, scopes: ['sites:write'] }),
    request: { params: idPathParams },
    responses: {
      200: jsonResponse('Archived site row', successEnvelope(siteRowSchema)),
      ...standardErrors({ unauthorized: true, forbidden: true, notFound: true, rateLimited: true }),
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/sites/{id}/audits',
    tags: ['Sites', 'Audits'],
    summary: 'List audit runs for a site',
    security: security({ cookie: true, apiKey: true, scopes: ['audits:read'] }),
    request: {
      params: idPathParams,
      query: z.object({
        kind: z.enum(['seo', 'lighthouse']).optional(),
        page: z.coerce.number().int().min(1).default(1),
        limit: z.coerce.number().int().min(1).max(100).default(20),
      }),
    },
    responses: {
      200: jsonResponse('Audit runs', successEnvelope(looseArray)),
      ...standardErrors({ unauthorized: true, forbidden: true, notFound: true, rateLimited: true }),
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/sites/{id}/audits',
    tags: ['Sites', 'Audits'],
    summary: 'Trigger an immediate audit run',
    security: security({ cookie: true, apiKey: true, scopes: ['audits:write'] }),
    request: {
      params: idPathParams,
      body: {
        content: {
          'application/json': {
            schema: z.object({ kind: z.enum(['seo', 'lighthouse']) }).openapi('TriggerAuditInput'),
          },
        },
      },
    },
    responses: {
      201: jsonResponse('Newly enqueued audit run', successEnvelope(looseObject)),
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
    path: '/sites/{id}/deployments',
    tags: ['Sites', 'Deployments'],
    summary: 'List recent deployments for a site',
    security: security({ cookie: true, apiKey: true, scopes: ['deployments:read'] }),
    request: { params: idPathParams },
    responses: {
      200: jsonResponse('Deployment list', successEnvelope(looseArray)),
      ...standardErrors({ unauthorized: true, forbidden: true, notFound: true, rateLimited: true }),
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/sites/{id}/domains',
    tags: ['Sites', 'Domains'],
    summary: 'List domains attached to a site',
    security: security({ cookie: true, apiKey: true, scopes: ['domains:read'] }),
    request: { params: idPathParams },
    responses: {
      200: jsonResponse('Domain list', successEnvelope(looseArray)),
      ...standardErrors({ unauthorized: true, forbidden: true, notFound: true, rateLimited: true }),
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/sites/{id}/domains',
    tags: ['Sites', 'Domains'],
    summary: 'Attach a new domain to a site',
    security: security({ cookie: true, apiKey: true, scopes: ['domains:write'] }),
    request: {
      params: idPathParams,
      body: {
        content: {
          'application/json': {
            schema: z
              .object({
                domain: z.string().min(1).max(255),
                isPrimary: z.boolean().optional(),
                registrar: z.string().max(80).optional(),
                registeredAt: z
                  .string()
                  .regex(/^\d{4}-\d{2}-\d{2}$/)
                  .optional(),
                expiresAt: z
                  .string()
                  .regex(/^\d{4}-\d{2}-\d{2}$/)
                  .optional(),
                autoRenew: z.boolean().optional(),
                dnsProvider: z.string().max(80).optional(),
              })
              .openapi('AttachDomainInput'),
          },
        },
      },
    },
    responses: {
      201: jsonResponse('Newly attached domain', successEnvelope(looseObject)),
      ...standardErrors({
        unauthorized: true,
        forbidden: true,
        validation: true,
        conflict: true,
        notFound: true,
        rateLimited: true,
      }),
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/sites/{id}/uptime',
    tags: ['Sites'],
    summary: 'Uptime time-series for a site',
    description:
      'Returns bucketed uptime + latency points. Granularity is auto-selected from the requested window. When `?cursor=...` is supplied, the route switches to cursor-paginated tail-list mode (T36) and returns `{ items: UptimeCheck[] }` with `CursorPaginationMeta` instead of the aggregate shape.',
    security: security({ cookie: true, apiKey: true, scopes: ['uptime:read'] }),
    request: {
      params: idPathParams,
      query: z.object({
        from: z.string().datetime({ offset: true }).optional(),
        to: z.string().datetime({ offset: true }).optional(),
        granularity: z.enum(['minute', 'hour', 'day']).optional(),
        cursor: z.string().min(1).max(512).optional(),
        limit: z.coerce.number().int().min(1).max(100).optional(),
        failuresOnly: z.enum(['true', 'false']).optional(),
      }),
    },
    responses: {
      200: jsonResponse(
        'Aggregate shape by default; cursor-paginated `UptimeCheck` list when `?cursor=` is set.',
        successEnvelope(z.union([looseObject, z.array(looseObject)])).extend({
          meta: cursorPaginationMeta.optional(),
        }),
      ),
      ...standardErrors({ unauthorized: true, forbidden: true, notFound: true, rateLimited: true }),
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/sites/{id}/uptime-check',
    tags: ['Sites'],
    summary: 'Trigger an immediate uptime probe',
    security: security({ cookie: true, apiKey: true, scopes: ['uptime:write'] }),
    request: { params: idPathParams },
    responses: {
      201: jsonResponse('Newly recorded uptime sample', successEnvelope(looseObject)),
      ...standardErrors({
        unauthorized: true,
        forbidden: true,
        notFound: true,
        rateLimited: true,
      }),
    },
  });
}
