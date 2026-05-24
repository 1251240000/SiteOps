/**
 * Single entry point used by both:
 *   - `app/api/v1/openapi.json/route.ts` runtime handler
 *   - `scripts/openapi-{generate,check}.ts` CI tools
 *
 * Calling `buildOpenApiDocument()` is idempotent — every call builds a
 * fresh registry so test setups can mutate state freely.
 */
import { OpenAPIRegistry, OpenApiGeneratorV31 } from '@asteasolutions/zod-to-openapi';

import { registerSecuritySchemes } from './common';
import { registerAll } from './routes';
// Side-effect: extend Zod with `.openapi(...)` exactly once.
import './extend';

type OpenApiConfig = Parameters<OpenApiGeneratorV31['generateDocument']>[0];

const baseConfig: OpenApiConfig = {
  openapi: '3.1.0',
  info: {
    title: 'SiteOps API',
    version: '1.0.0',
    description:
      'Internal API surface of the SiteOps platform. Stable v1 contract; see `docs/04-api-spec.md` for envelope, auth and pagination conventions.',
  },
  servers: [{ url: '/api/v1', description: 'Same-origin /api/v1 base path' }],
  tags: [
    { name: 'Auth', description: 'Session helpers.' },
    { name: 'Sites', description: 'Site registry CRUD + per-site sub-resources.' },
    { name: 'Domains', description: 'Domain ownership + SSL/expiry metadata.' },
    { name: 'Deployments', description: 'Deployment ingestion + history.' },
    { name: 'Audits', description: 'SEO / Lighthouse audit runs.' },
    { name: 'Errors', description: 'Site-side error ingestion + triage.' },
    { name: 'Alerts', description: 'Alert rules, channels and dispatched events.' },
    { name: 'Metrics', description: 'Traffic time-series + per-site search insights.' },
    { name: 'Revenue', description: 'AdSense + affiliate revenue reporting.' },
    { name: 'ROI', description: 'Per-site cost entry + ROI tables.' },
    { name: 'Tasks', description: 'Agent task queue (claim / complete / fail / heartbeat).' },
    { name: 'Agent Runs', description: 'Bearer-call audit log for Agents.' },
    { name: 'Integrations', description: 'External provider OAuth + sync triggers.' },
    { name: 'Hooks', description: 'Inbound webhooks from CF / GitHub + admin replay.' },
    { name: 'Settings', description: 'Workspace settings (API keys, locale).' },
    { name: 'System', description: 'Admin diagnostic endpoints (version, queue depths).' },
    { name: 'Me', description: 'Current-user preferences.' },
  ],
};

/** Build a fresh OpenAPI 3.1 document covering every v1 route. */
export function buildOpenApiDocument(): ReturnType<OpenApiGeneratorV31['generateDocument']> {
  const registry = new OpenAPIRegistry();
  registerSecuritySchemes(registry);
  registerAll(registry);
  return new OpenApiGeneratorV31(registry.definitions).generateDocument(baseConfig);
}
