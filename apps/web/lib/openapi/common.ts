/**
 * Shared OpenAPI building blocks: response envelopes, error shape, security
 * schemes, and helpers that turn a route's input schemas into the
 * `request` / `responses` blocks expected by `OpenAPIRegistry.registerPath`.
 */
import type { OpenAPIRegistry, RouteConfig } from '@asteasolutions/zod-to-openapi';

import { z } from './extend';

/** UUID path-parameter helper. Reused across `[id]`-style routes. */
export const idParam = z.string().uuid().openapi({
  description: 'UUID v4 identifier.',
  example: '8c5a8e4a-5e91-4f7d-9f9e-1f9b3c8b6c2c',
});

/** Canonical error envelope matching `docs/04-api-spec.md §2`. */
export const errorEnvelopeSchema = z
  .object({
    error: z.object({
      code: z.string().openapi({
        description: 'Stable machine-readable error code.',
        example: 'validation_failed',
      }),
      message: z.string().openapi({ example: 'Invalid request body' }),
      requestId: z.string().openapi({ example: 'req_01HXY...' }),
      details: z.unknown().optional().openapi({
        description: 'Optional structured detail payload (e.g. Zod flattened errors).',
      }),
    }),
  })
  .openapi('ErrorEnvelope');

/**
 * `{ data, meta? }` success envelope. `data` is typed per call site to keep
 * the spec readable; passing `z.unknown()` is fine when the shape is
 * dynamic (e.g. service-layer rows).
 */
export function successEnvelope<T extends z.ZodTypeAny>(data: T) {
  return z.object({
    data,
    meta: z.record(z.unknown()).optional(),
  });
}

/** Generic meta shape for offset paginated list responses. */
export const offsetPaginationMeta = z
  .object({
    page: z.number().int(),
    limit: z.number().int(),
    total: z.number().int(),
    totalPages: z.number().int(),
  })
  .openapi('OffsetPaginationMeta');

/**
 * Generic meta shape for cursor paginated list responses (T36).
 *
 * Wire format: `meta: { cursor: { next: string | null }, hasMore: boolean, limit: number }`.
 * `cursor.next` is `null` on the final page; `hasMore` is `true` iff a
 * follow-up `?cursor=...` call would return more rows.
 */
export const cursorPaginationMeta = z
  .object({
    cursor: z
      .object({
        next: z.string().nullable(),
      })
      .openapi('CursorPaginationCursor'),
    hasMore: z.boolean(),
    limit: z.number().int(),
  })
  .openapi('CursorPaginationMeta');

/** Common JSON response factory — saves boilerplate at every call site. */
export function jsonResponse<T extends z.ZodTypeAny>(
  description: string,
  schema: T,
): RouteConfig['responses'][number] {
  return {
    description,
    content: { 'application/json': { schema } },
  };
}

/** Standard error response variants reused across routes. */
export function standardErrors(opts: {
  validation?: boolean;
  unauthorized?: boolean;
  forbidden?: boolean;
  notFound?: boolean;
  rateLimited?: boolean;
  conflict?: boolean;
}): Record<string, RouteConfig['responses'][number]> {
  const out: Record<string, RouteConfig['responses'][number]> = {};
  if (opts.validation) out['400'] = jsonResponse('Validation failed', errorEnvelopeSchema);
  if (opts.unauthorized) out['401'] = jsonResponse('Authentication required', errorEnvelopeSchema);
  if (opts.forbidden) out['403'] = jsonResponse('Insufficient scope', errorEnvelopeSchema);
  if (opts.notFound) out['404'] = jsonResponse('Resource not found', errorEnvelopeSchema);
  if (opts.conflict) out['409'] = jsonResponse('Conflict', errorEnvelopeSchema);
  if (opts.rateLimited) out['429'] = jsonResponse('Rate limited', errorEnvelopeSchema);
  out['500'] = jsonResponse('Internal server error', errorEnvelopeSchema);
  return out;
}

/**
 * Register the two security schemes the platform supports (cookie session
 * + bearer API key). Call this once at registry-build time.
 */
export function registerSecuritySchemes(registry: OpenAPIRegistry): void {
  registry.registerComponent('securitySchemes', 'bearerAuth', {
    type: 'http',
    scheme: 'bearer',
    description:
      'API key minted via `/settings/api-keys`. The scope set on the key must include every scope listed under the path.',
  });
  registry.registerComponent('securitySchemes', 'cookieAuth', {
    type: 'apiKey',
    in: 'cookie',
    name: 'authjs.session-token',
    description: 'Browser-only Auth.js session cookie for dashboard requests.',
  });
}

/**
 * Build the `security` array based on which authentication modes the route
 * accepts. The dashboard cookie path takes no scopes; the API-key path
 * requires the listed scopes on the key.
 */
export function security(opts: {
  cookie?: boolean;
  apiKey?: boolean;
  scopes?: readonly string[];
}): RouteConfig['security'] {
  const out: NonNullable<RouteConfig['security']> = [];
  if (opts.cookie) out.push({ cookieAuth: [] });
  if (opts.apiKey) out.push({ bearerAuth: [...(opts.scopes ?? [])] });
  return out;
}

/** Convenience: queryparam adapter so we can pass plain Zod object schemas. */
export function queryParams<T extends z.ZodRawShape>(shape: T): z.ZodObject<T> {
  return z.object(shape);
}

/**
 * Cheap "data shape" placeholder for routes whose response payload is a raw
 * service-layer row that we don't want to enumerate column-by-column. The
 * spec keeps `type: object` + `additionalProperties: true` and humans can
 * inspect the live response in Swagger UI.
 */
export const looseObject = z
  .record(z.unknown())
  .openapi({ description: 'Service-layer row; structure follows the underlying DB schema.' });

export const looseArray = z.array(looseObject);
