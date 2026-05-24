import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';

import { jsonResponse, looseObject, security, standardErrors, successEnvelope } from '../common';
import { z } from '../extend';

const tokenBodySchema = z
  .object({ token: z.string().min(1).max(2000).optional() })
  .openapi('IntegrationTokenInput');

const cfTokenBodySchema = z
  .object({ apiToken: z.string().min(1).max(2000).optional() })
  .openapi('CloudflareTokenInput');

const ga4PropertyBodySchema = z
  .object({ propertyId: z.string().min(1).max(64).optional() })
  .openapi('Ga4PropertyInput');

export function registerIntegrations(registry: OpenAPIRegistry): void {
  registry.registerPath({
    method: 'get',
    path: '/integrations/status',
    tags: ['Integrations'],
    summary: 'Aggregate connectivity status of every integration',
    security: security({ cookie: true }),
    responses: {
      200: jsonResponse('Status object', successEnvelope(looseObject)),
      ...standardErrors({ unauthorized: true }),
    },
  });

  // Cloudflare
  registry.registerPath({
    method: 'post',
    path: '/integrations/cloudflare/test',
    tags: ['Integrations'],
    summary: 'Probe a Cloudflare API token',
    security: security({ cookie: true }),
    request: { body: { content: { 'application/json': { schema: cfTokenBodySchema } } } },
    responses: {
      200: jsonResponse('Probe result', successEnvelope(looseObject)),
      ...standardErrors({ unauthorized: true, validation: true }),
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/integrations/cloudflare/sync',
    tags: ['Integrations'],
    summary: 'Trigger a Cloudflare sync now',
    security: security({ cookie: true }),
    responses: {
      200: jsonResponse('Sync summary', successEnvelope(looseObject)),
      ...standardErrors({ unauthorized: true, validation: true }),
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/integrations/cloudflare/projects',
    tags: ['Integrations'],
    summary: 'List Cloudflare Pages projects visible to the configured token',
    security: security({ cookie: true }),
    responses: {
      200: jsonResponse('Projects list', successEnvelope(z.array(looseObject))),
      ...standardErrors({ unauthorized: true, validation: true }),
    },
  });

  // GitHub
  registry.registerPath({
    method: 'post',
    path: '/integrations/github/test',
    tags: ['Integrations'],
    summary: 'Probe a GitHub PAT',
    security: security({ cookie: true }),
    request: { body: { content: { 'application/json': { schema: tokenBodySchema } } } },
    responses: {
      200: jsonResponse('Probe result', successEnvelope(looseObject)),
      ...standardErrors({ unauthorized: true, validation: true }),
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/integrations/github/sync',
    tags: ['Integrations'],
    summary: 'Trigger a GitHub repos / actions sync now',
    security: security({ cookie: true }),
    responses: {
      200: jsonResponse('Sync summary', successEnvelope(looseObject)),
      ...standardErrors({ unauthorized: true, validation: true }),
    },
  });

  // GA4
  registry.registerPath({
    method: 'post',
    path: '/integrations/ga4/test',
    tags: ['Integrations'],
    summary: 'Probe GA4 service-account credentials',
    security: security({ cookie: true }),
    request: { body: { content: { 'application/json': { schema: ga4PropertyBodySchema } } } },
    responses: {
      200: jsonResponse('Probe result', successEnvelope(looseObject)),
      ...standardErrors({ unauthorized: true, validation: true }),
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/integrations/ga4/sync',
    tags: ['Integrations'],
    summary: 'Trigger a GA4 PV/UV sync now',
    security: security({ cookie: true }),
    responses: {
      200: jsonResponse('Sync summary', successEnvelope(looseObject)),
      ...standardErrors({ unauthorized: true, validation: true }),
    },
  });

  // Search Console
  registry.registerPath({
    method: 'get',
    path: '/integrations/gsc/auth-url',
    tags: ['Integrations'],
    summary: 'Mint a Search Console OAuth consent URL',
    security: security({ cookie: true }),
    responses: {
      200: jsonResponse('Auth URL', successEnvelope(z.object({ url: z.string().url() }))),
      ...standardErrors({ unauthorized: true, validation: true }),
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/integrations/gsc/callback',
    tags: ['Integrations'],
    summary: 'OAuth callback (handled by browser)',
    description:
      'Exchanges the auth code for tokens and persists them. Designed for browser redirects, not direct API calls.',
    security: security({ cookie: true }),
    request: {
      query: z.object({
        code: z.string().min(1),
        state: z.string().min(1).optional(),
      }),
    },
    responses: {
      200: jsonResponse('OAuth callback result', successEnvelope(looseObject)),
      ...standardErrors({ unauthorized: true, validation: true }),
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/integrations/gsc/sync',
    tags: ['Integrations'],
    summary: 'Trigger a Search Console sync now',
    security: security({ cookie: true }),
    responses: {
      200: jsonResponse('Sync summary', successEnvelope(looseObject)),
      ...standardErrors({ unauthorized: true, validation: true }),
    },
  });

  // AdSense
  registry.registerPath({
    method: 'get',
    path: '/integrations/adsense/auth-url',
    tags: ['Integrations'],
    summary: 'Mint an AdSense OAuth consent URL',
    security: security({ cookie: true }),
    responses: {
      200: jsonResponse('Auth URL', successEnvelope(z.object({ url: z.string().url() }))),
      ...standardErrors({ unauthorized: true, validation: true }),
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/integrations/adsense/callback',
    tags: ['Integrations'],
    summary: 'AdSense OAuth callback',
    security: security({ cookie: true }),
    request: {
      query: z.object({
        code: z.string().min(1),
        state: z.string().min(1).optional(),
      }),
    },
    responses: {
      200: jsonResponse('OAuth callback result', successEnvelope(looseObject)),
      ...standardErrors({ unauthorized: true, validation: true }),
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/integrations/adsense/sync',
    tags: ['Integrations'],
    summary: 'Trigger an AdSense earnings sync now',
    security: security({ cookie: true }),
    responses: {
      200: jsonResponse('Sync summary', successEnvelope(looseObject)),
      ...standardErrors({ unauthorized: true, validation: true }),
    },
  });
}
