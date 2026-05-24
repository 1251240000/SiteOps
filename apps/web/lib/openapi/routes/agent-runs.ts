import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';

import { agentRunSummaryQuerySchema, listAgentRunsQuerySchema } from '@siteops/shared';

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

const agentRunRowSchema = looseObject.openapi('AgentRunRow');

export function registerAgentRuns(registry: OpenAPIRegistry): void {
  registry.registerPath({
    method: 'get',
    path: '/agent-runs',
    tags: ['Agent Runs'],
    summary: 'List Agent run audit log',
    description:
      'Admin-only. Supports both legacy `?page=N` offset and `?cursor=...` keyset pagination — see T36 in `tasks/M8-api-contract`. API keys are deliberately rejected to prevent agents enumerating each other.',
    security: security({ cookie: true }),
    request: { query: listAgentRunsQuerySchema },
    responses: {
      200: jsonResponse(
        'Paginated list. Meta is `OffsetPaginationMeta` when `page` is used, `CursorPaginationMeta` when `cursor` is used.',
        successEnvelope(z.array(agentRunRowSchema)).extend({
          meta: z.union([offsetPaginationMeta, cursorPaginationMeta]),
        }),
      ),
      ...standardErrors({ unauthorized: true, validation: true }),
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/agent-runs/{id}',
    tags: ['Agent Runs'],
    summary: 'Get an Agent run audit row by id',
    security: security({ cookie: true }),
    request: { params: z.object({ id: idParam }) },
    responses: {
      200: jsonResponse('Agent run detail', successEnvelope(agentRunRowSchema)),
      ...standardErrors({ unauthorized: true, notFound: true }),
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/agent-runs/summary',
    tags: ['Agent Runs'],
    summary: 'Aggregate stats over a time window',
    security: security({ cookie: true }),
    request: { query: agentRunSummaryQuerySchema },
    responses: {
      200: jsonResponse('Aggregate summary', successEnvelope(looseObject)),
      ...standardErrors({ unauthorized: true, validation: true }),
    },
  });
}
