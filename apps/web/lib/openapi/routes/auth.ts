import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';

import { jsonResponse, security, standardErrors, successEnvelope } from '../common';
import { z } from '../extend';

const meSchema = z
  .object({
    id: z.string().uuid(),
    email: z.string().email(),
    name: z.string().nullable(),
  })
  .openapi('SessionUser');

export function registerAuth(registry: OpenAPIRegistry): void {
  registry.registerPath({
    method: 'get',
    path: '/auth/me',
    tags: ['Auth'],
    summary: 'Current admin session info',
    description: 'Returns the logged-in admin profile. Requires a valid session cookie.',
    security: security({ cookie: true }),
    responses: {
      200: jsonResponse('Logged-in user', successEnvelope(meSchema)),
      ...standardErrors({ unauthorized: true }),
    },
  });
}
