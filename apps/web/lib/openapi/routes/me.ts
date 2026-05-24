import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';

import { jsonResponse, security, standardErrors, successEnvelope } from '../common';
import { z } from '../extend';

const localeBodySchema = z
  .object({
    locale: z.enum(['zh-CN', 'en-US']).openapi({ description: 'BCP-47 locale tag.' }),
  })
  .openapi('UpdateLocaleInput');

const localePrefSchema = z
  .object({
    locale: z.enum(['zh-CN', 'en-US']),
  })
  .openapi('LocalePreference');

export function registerMe(registry: OpenAPIRegistry): void {
  registry.registerPath({
    method: 'post',
    path: '/me/preferences/locale',
    tags: ['Me'],
    summary: 'Persist current user locale preference',
    description:
      'Stores the dashboard locale on the session. The browser also writes a `siteops-locale` cookie client-side for instant rendering.',
    security: security({ cookie: true }),
    request: {
      body: { content: { 'application/json': { schema: localeBodySchema } } },
    },
    responses: {
      200: jsonResponse('Updated locale preference', successEnvelope(localePrefSchema)),
      ...standardErrors({ unauthorized: true, validation: true }),
    },
  });
}
