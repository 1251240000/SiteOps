import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';

import { createDeploymentSchema, listDeploymentsQuerySchema } from '@siteops/shared';

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

const deploymentRowSchema = looseObject.openapi('DeploymentRow');

export function registerDeployments(registry: OpenAPIRegistry): void {
  registry.registerPath({
    method: 'get',
    path: '/deployments',
    tags: ['Deployments'],
    summary: 'List deployments',
    security: security({ cookie: true, apiKey: true, scopes: ['deployments:read'] }),
    request: { query: listDeploymentsQuerySchema },
    responses: {
      200: jsonResponse(
        'Paginated list',
        successEnvelope(z.array(deploymentRowSchema)).extend({ meta: offsetPaginationMeta }),
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
    path: '/deployments',
    tags: ['Deployments'],
    summary: 'Report a deployment',
    description:
      'Used by Agents / CI to upload a deployment record. Either `(provider, providerDeploymentId)` or `commitSha` must be set; idempotent on either pair via the DB unique index.',
    security: security({ cookie: true, apiKey: true, scopes: ['deployments:write'] }),
    request: {
      body: {
        content: {
          'application/json': { schema: createDeploymentSchema.openapi('CreateDeploymentInput') },
        },
      },
    },
    responses: {
      201: jsonResponse(
        'New (or existing duplicate) deployment',
        successEnvelope(deploymentRowSchema),
      ),
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
    path: '/deployments/{id}',
    tags: ['Deployments'],
    summary: 'Get a deployment by id',
    security: security({ cookie: true, apiKey: true, scopes: ['deployments:read'] }),
    request: { params: z.object({ id: idParam }) },
    responses: {
      200: jsonResponse('Deployment detail', successEnvelope(deploymentRowSchema)),
      ...standardErrors({ unauthorized: true, forbidden: true, notFound: true, rateLimited: true }),
    },
  });
}
