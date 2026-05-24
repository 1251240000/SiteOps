import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';

import {
  idParam,
  jsonResponse,
  looseArray,
  looseObject,
  security,
  standardErrors,
  successEnvelope,
} from '../common';
import { z } from '../extend';

const auditRowSchema = looseObject.openapi('AuditRunRow');
const findingRowSchema = looseObject.openapi('AuditFindingRow');
const idPathParams = z.object({ id: idParam });

export function registerAudits(registry: OpenAPIRegistry): void {
  registry.registerPath({
    method: 'get',
    path: '/audits/{id}',
    tags: ['Audits'],
    summary: 'Get an audit run by id',
    security: security({ cookie: true, apiKey: true, scopes: ['audits:read'] }),
    request: { params: idPathParams },
    responses: {
      200: jsonResponse('Audit run detail', successEnvelope(auditRowSchema)),
      ...standardErrors({ unauthorized: true, forbidden: true, notFound: true, rateLimited: true }),
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/audits/{id}/findings',
    tags: ['Audits'],
    summary: 'List findings produced by an audit run',
    security: security({ cookie: true, apiKey: true, scopes: ['audits:read'] }),
    request: { params: idPathParams },
    responses: {
      200: jsonResponse('Findings list', successEnvelope(z.array(findingRowSchema))),
      ...standardErrors({ unauthorized: true, forbidden: true, notFound: true, rateLimited: true }),
    },
  });

  void looseArray;
}
