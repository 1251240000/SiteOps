import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';

import { createDomainSchema, listDomainsQuerySchema, updateDomainSchema } from '@siteops/shared';

import {
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

const domainRowSchema = looseObject.openapi('DomainRow');
const idPathParams = z.object({ id: idParam });

export function registerDomains(registry: OpenAPIRegistry): void {
  registry.registerPath({
    method: 'get',
    path: '/domains',
    tags: ['Domains'],
    summary: 'List domains',
    security: security({ cookie: true, apiKey: true, scopes: ['domains:read'] }),
    request: { query: listDomainsQuerySchema },
    responses: {
      200: jsonResponse(
        'Paginated list',
        successEnvelope(z.array(domainRowSchema)).extend({ meta: offsetPaginationMeta }),
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
    path: '/domains',
    tags: ['Domains'],
    summary: 'Create a domain',
    description: 'Attaches a new domain row to an existing site.',
    security: security({ cookie: true, apiKey: true, scopes: ['domains:write'] }),
    request: {
      body: {
        content: {
          'application/json': { schema: createDomainSchema.openapi('CreateDomainInput') },
        },
      },
    },
    responses: {
      201: jsonResponse('Created domain', successEnvelope(domainRowSchema)),
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
    path: '/domains/{id}',
    tags: ['Domains'],
    summary: 'Get a domain by id',
    security: security({ cookie: true, apiKey: true, scopes: ['domains:read'] }),
    request: { params: idPathParams },
    responses: {
      200: jsonResponse('Domain detail', successEnvelope(domainRowSchema)),
      ...standardErrors({ unauthorized: true, forbidden: true, notFound: true, rateLimited: true }),
    },
  });

  registry.registerPath({
    method: 'patch',
    path: '/domains/{id}',
    tags: ['Domains'],
    summary: 'Update a domain (partial)',
    security: security({ cookie: true, apiKey: true, scopes: ['domains:write'] }),
    request: {
      params: idPathParams,
      body: {
        content: {
          'application/json': { schema: updateDomainSchema.openapi('UpdateDomainInput') },
        },
      },
    },
    responses: {
      200: jsonResponse('Updated domain', successEnvelope(domainRowSchema)),
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
    path: '/domains/{id}',
    tags: ['Domains'],
    summary: 'Delete a domain',
    security: security({ cookie: true, apiKey: true, scopes: ['domains:write'] }),
    request: { params: idPathParams },
    responses: {
      200: jsonResponse('Deleted domain row', successEnvelope(domainRowSchema)),
      ...standardErrors({ unauthorized: true, forbidden: true, notFound: true, rateLimited: true }),
    },
  });

  // Note: list-by-site lives on /sites/{id}/domains (registered in sites.ts).
  void looseArray;
}
