/**
 * `/api/v1/system/*` admin diagnostic endpoints (T38).
 *
 * Both routes are admin-only (cookie session). Bearer keys are deliberately
 * rejected: per-queue depth and version metadata are operationally
 * sensitive and shouldn't appear on the public API surface that external
 * agents pull on.
 */
import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';

import { jsonResponse, security, standardErrors, successEnvelope } from '../common';
import { z } from '../extend';

const systemVersionSchema = z
  .object({
    version: z.string().openapi({ example: '1.2.3' }),
    gitSha: z.string().nullable().openapi({ example: 'deadbeef' }),
    nodeVersion: z.string().openapi({ example: 'v20.16.0' }),
    startedAt: z.string().nullable().openapi({
      description: 'ISO 8601 boot timestamp stamped by `instrumentation.ts`.',
      example: '2026-05-19T01:00:00.000Z',
    }),
  })
  .openapi('SystemVersion');

const queueSnapshotSchema = z
  .object({
    name: z.string().openapi({ example: 'uptime-check' }),
    waiting: z.number().int().nonnegative(),
    active: z.number().int().nonnegative(),
    delayed: z.number().int().nonnegative(),
    completed: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    error: z.string().optional().openapi({
      description:
        'Set when this queue could not be reached (e.g. transient Redis error). Counts in that case are zeros.',
    }),
  })
  .openapi('QueueStatusSnapshot');

export function registerSystem(registry: OpenAPIRegistry): void {
  registry.registerPath({
    method: 'get',
    path: '/system/version',
    tags: ['System'],
    summary: 'Build + runtime metadata',
    description:
      'Returns the running build version, git SHA, Node runtime, and boot timestamp. Useful for confirming a deploy reached a given replica.',
    security: security({ cookie: true }),
    responses: {
      200: jsonResponse('Version metadata', successEnvelope(systemVersionSchema)),
      ...standardErrors({ unauthorized: true }),
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/system/jobs',
    tags: ['System'],
    summary: 'BullMQ queue snapshot',
    description:
      'Returns `waiting / active / delayed / completed / failed` counts per queue. A failing queue surfaces with `error` set and zero counts; sibling queues are unaffected.',
    security: security({ cookie: true }),
    responses: {
      200: jsonResponse('Per-queue counts', successEnvelope(z.array(queueSnapshotSchema))),
      ...standardErrors({ unauthorized: true }),
    },
  });
}
