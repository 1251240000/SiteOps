import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';

import { createApiKeySchema, updateApiKeySchema } from '@siteops/shared';

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

const apiKeyRowSchema = looseObject.openapi('ApiKeyRow');

const apiKeyListQuery = z.object({
  state: z.enum(['active', 'revoked', 'expired']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

const createApiKeyOpenApi = createApiKeySchema.openapi('CreateApiKeyInput');
const updateApiKeyOpenApi = updateApiKeySchema.openapi('UpdateApiKeyInput');

const newApiKeyOutputSchema = z
  .object({
    apiKey: apiKeyRowSchema,
    plaintext: z.string().openapi({
      description: 'Returned only once at creation. Display to the admin then forget.',
    }),
  })
  .openapi('NewApiKey');

export function registerSettings(registry: OpenAPIRegistry): void {
  registry.registerPath({
    method: 'get',
    path: '/settings/api-keys',
    tags: ['Settings'],
    summary: 'List API keys (safe view)',
    description: 'Admin-only. Never returns the bearer hash; only metadata + scopes.',
    security: security({ cookie: true }),
    request: { query: apiKeyListQuery },
    responses: {
      200: jsonResponse(
        'Paginated list',
        successEnvelope(z.array(apiKeyRowSchema)).extend({ meta: offsetPaginationMeta }),
      ),
      ...standardErrors({ unauthorized: true }),
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/settings/api-keys',
    tags: ['Settings'],
    summary: 'Issue a new API key',
    description:
      'Mints a new API key. Plaintext is returned **once** in `data.plaintext`; subsequent reads of the row never expose it again.',
    security: security({ cookie: true }),
    request: {
      body: { content: { 'application/json': { schema: createApiKeyOpenApi } } },
    },
    responses: {
      201: jsonResponse(
        'Newly minted API key (plaintext + row)',
        successEnvelope(newApiKeyOutputSchema),
      ),
      ...standardErrors({ unauthorized: true, validation: true }),
    },
  });

  registry.registerPath({
    method: 'patch',
    path: '/settings/api-keys/{id}',
    tags: ['Settings'],
    summary: 'Update mutable fields on an API key',
    description:
      'Currently only `rateLimitPerMin` is mutable post-creation. Pass `null` to clear the per-key override and restore the env default. The in-process API-key cache is invalidated so the new limit applies immediately on this replica.',
    security: security({ cookie: true }),
    request: {
      params: z.object({ id: idParam }),
      body: { content: { 'application/json': { schema: updateApiKeyOpenApi } } },
    },
    responses: {
      200: jsonResponse('Updated API key row', successEnvelope(apiKeyRowSchema)),
      ...standardErrors({ unauthorized: true, notFound: true, validation: true }),
    },
  });

  registry.registerPath({
    method: 'delete',
    path: '/settings/api-keys/{id}',
    tags: ['Settings'],
    summary: 'Revoke an API key',
    description: 'Marks the key as revoked; future Bearer requests fail with 401.',
    security: security({ cookie: true }),
    request: { params: z.object({ id: idParam }) },
    responses: {
      200: jsonResponse('Revoked API key row', successEnvelope(apiKeyRowSchema)),
      ...standardErrors({ unauthorized: true, notFound: true }),
    },
  });
}
