import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';

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

const webhookEventRowSchema = looseObject.openapi('WebhookEventRow');

const providerParam = z.enum(['cloudflare', 'github']).openapi({
  description: 'Inbound webhook provider.',
});

export function registerHooks(registry: OpenAPIRegistry): void {
  registry.registerPath({
    method: 'get',
    path: '/hooks',
    tags: ['Hooks'],
    summary: 'List ingested webhook events (admin)',
    description:
      'Supports both `?page=N` offset and `?cursor=...` keyset pagination (T36). When `cursor` is set, `page` is ignored and meta becomes `CursorPaginationMeta`.',
    security: security({ cookie: true }),
    request: {
      query: z.object({
        provider: providerParam.optional(),
        state: z.enum(['processed', 'failed', 'pending']).optional(),
        signatureOk: z.enum(['true', 'false']).optional(),
        page: z.coerce.number().int().min(1).default(1),
        cursor: z.string().min(1).max(512).optional(),
        limit: z.coerce.number().int().min(1).max(100).default(50),
      }),
    },
    responses: {
      200: jsonResponse(
        'Paginated list. Meta is `OffsetPaginationMeta` when `page` is used, `CursorPaginationMeta` when `cursor` is used.',
        successEnvelope(z.array(webhookEventRowSchema)).extend({
          meta: z.union([offsetPaginationMeta, cursorPaginationMeta]),
        }),
      ),
      ...standardErrors({ unauthorized: true, validation: true }),
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/hooks/cloudflare',
    tags: ['Hooks'],
    summary: 'Cloudflare Pages webhook entrypoint',
    description:
      'Validates the `cf-webhook-auth` HMAC and persists the event. See `docs/04-api-spec.md §4` for status code matrix.',
    request: {
      body: { content: { 'application/json': { schema: looseObject } } },
    },
    responses: {
      202: jsonResponse('Accepted', successEnvelope(looseObject)),
      200: jsonResponse('Duplicate delivery (already ingested)', successEnvelope(looseObject)),
      400: jsonResponse('Validation failed', successEnvelope(looseObject)),
      401: jsonResponse('Bad signature', successEnvelope(looseObject)),
      415: jsonResponse('Unsupported media type', successEnvelope(looseObject)),
      503: jsonResponse('Webhook secret not configured', successEnvelope(looseObject)),
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/hooks/github',
    tags: ['Hooks'],
    summary: 'GitHub webhook entrypoint',
    description:
      'Validates the `x-hub-signature-256` HMAC and persists the event. Handles `workflow_run`, `push`, `deployment_status`, and `ping`.',
    request: {
      body: { content: { 'application/json': { schema: looseObject } } },
    },
    responses: {
      202: jsonResponse('Accepted', successEnvelope(looseObject)),
      200: jsonResponse('Duplicate delivery (already ingested)', successEnvelope(looseObject)),
      400: jsonResponse('Validation failed', successEnvelope(looseObject)),
      401: jsonResponse('Bad signature', successEnvelope(looseObject)),
      415: jsonResponse('Unsupported media type', successEnvelope(looseObject)),
      503: jsonResponse('Webhook secret not configured', successEnvelope(looseObject)),
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/hooks/{provider}/replay/{id}',
    tags: ['Hooks'],
    summary: 'Replay a previously ingested webhook event (admin)',
    description:
      'Re-runs the dispatch path using the stored payload. Cannot replay rows with `signature_ok=false`.',
    security: security({ cookie: true }),
    request: {
      params: z.object({ provider: providerParam, id: idParam }),
    },
    responses: {
      200: jsonResponse('Replay result', successEnvelope(webhookEventRowSchema)),
      ...standardErrors({
        unauthorized: true,
        forbidden: true,
        validation: true,
        notFound: true,
      }),
    },
  });
}
