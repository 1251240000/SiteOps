import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';

import {
  createAlertChannelSchema,
  createAlertRuleSchema,
  testChannelSchema,
  updateAlertChannelSchema,
  updateAlertRuleSchema,
} from '@siteops/shared';

import {
  idParam,
  jsonResponse,
  looseObject,
  security,
  standardErrors,
  successEnvelope,
} from '../common';
import { z } from '../extend';

const ruleRowSchema = looseObject.openapi('AlertRuleRow');
const channelRowSchema = looseObject.openapi('AlertChannelRow');
const eventRowSchema = looseObject.openapi('AlertEventRow');
const idPathParams = z.object({ id: idParam });

export function registerAlerts(registry: OpenAPIRegistry): void {
  // Rules CRUD ----------------------------------------------------------
  registry.registerPath({
    method: 'get',
    path: '/alert-rules',
    tags: ['Alerts'],
    summary: 'List alert rules',
    security: security({ cookie: true }),
    responses: {
      200: jsonResponse('Rule list', successEnvelope(z.array(ruleRowSchema))),
      ...standardErrors({ unauthorized: true }),
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/alert-rules',
    tags: ['Alerts'],
    summary: 'Create an alert rule',
    security: security({ cookie: true }),
    request: {
      body: {
        content: {
          'application/json': { schema: createAlertRuleSchema.openapi('CreateAlertRuleInput') },
        },
      },
    },
    responses: {
      201: jsonResponse('Created rule', successEnvelope(ruleRowSchema)),
      ...standardErrors({ unauthorized: true, validation: true }),
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/alert-rules/{id}',
    tags: ['Alerts'],
    summary: 'Get an alert rule by id',
    security: security({ cookie: true }),
    request: { params: idPathParams },
    responses: {
      200: jsonResponse('Rule detail', successEnvelope(ruleRowSchema)),
      ...standardErrors({ unauthorized: true, notFound: true }),
    },
  });

  registry.registerPath({
    method: 'patch',
    path: '/alert-rules/{id}',
    tags: ['Alerts'],
    summary: 'Update an alert rule (partial)',
    security: security({ cookie: true }),
    request: {
      params: idPathParams,
      body: {
        content: {
          'application/json': { schema: updateAlertRuleSchema.openapi('UpdateAlertRuleInput') },
        },
      },
    },
    responses: {
      200: jsonResponse('Updated rule', successEnvelope(ruleRowSchema)),
      ...standardErrors({ unauthorized: true, validation: true, notFound: true }),
    },
  });

  registry.registerPath({
    method: 'delete',
    path: '/alert-rules/{id}',
    tags: ['Alerts'],
    summary: 'Delete an alert rule',
    security: security({ cookie: true }),
    request: { params: idPathParams },
    responses: {
      200: jsonResponse('Deleted rule', successEnvelope(ruleRowSchema)),
      ...standardErrors({ unauthorized: true, notFound: true }),
    },
  });

  // Channels CRUD -------------------------------------------------------
  registry.registerPath({
    method: 'get',
    path: '/alert-channels',
    tags: ['Alerts'],
    summary: 'List alert channels',
    security: security({ cookie: true }),
    responses: {
      200: jsonResponse('Channel list', successEnvelope(z.array(channelRowSchema))),
      ...standardErrors({ unauthorized: true }),
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/alert-channels',
    tags: ['Alerts'],
    summary: 'Create an alert channel',
    security: security({ cookie: true }),
    request: {
      body: {
        content: {
          'application/json': {
            schema: createAlertChannelSchema.openapi('CreateAlertChannelInput'),
          },
        },
      },
    },
    responses: {
      201: jsonResponse('Created channel', successEnvelope(channelRowSchema)),
      ...standardErrors({ unauthorized: true, validation: true }),
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/alert-channels/{id}',
    tags: ['Alerts'],
    summary: 'Get an alert channel by id',
    security: security({ cookie: true }),
    request: { params: idPathParams },
    responses: {
      200: jsonResponse('Channel detail', successEnvelope(channelRowSchema)),
      ...standardErrors({ unauthorized: true, notFound: true }),
    },
  });

  registry.registerPath({
    method: 'patch',
    path: '/alert-channels/{id}',
    tags: ['Alerts'],
    summary: 'Update an alert channel (partial)',
    security: security({ cookie: true }),
    request: {
      params: idPathParams,
      body: {
        content: {
          'application/json': {
            schema: updateAlertChannelSchema.openapi('UpdateAlertChannelInput'),
          },
        },
      },
    },
    responses: {
      200: jsonResponse('Updated channel', successEnvelope(channelRowSchema)),
      ...standardErrors({ unauthorized: true, validation: true, notFound: true }),
    },
  });

  registry.registerPath({
    method: 'delete',
    path: '/alert-channels/{id}',
    tags: ['Alerts'],
    summary: 'Delete an alert channel',
    security: security({ cookie: true }),
    request: { params: idPathParams },
    responses: {
      200: jsonResponse('Deleted channel', successEnvelope(channelRowSchema)),
      ...standardErrors({ unauthorized: true, notFound: true }),
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/alert-channels/{id}/test',
    tags: ['Alerts'],
    summary: 'Send a test message through an alert channel',
    security: security({ cookie: true }),
    request: {
      params: idPathParams,
      body: {
        content: { 'application/json': { schema: testChannelSchema.openapi('TestChannelInput') } },
      },
    },
    responses: {
      200: jsonResponse('Dispatch result', successEnvelope(looseObject)),
      ...standardErrors({ unauthorized: true, validation: true, notFound: true }),
    },
  });

  // Alerts (events) -----------------------------------------------------
  registry.registerPath({
    method: 'get',
    path: '/alerts',
    tags: ['Alerts'],
    summary: 'List dispatched alert events',
    security: security({ cookie: true }),
    responses: {
      200: jsonResponse('Event list', successEnvelope(z.array(eventRowSchema))),
      ...standardErrors({ unauthorized: true }),
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/alerts/{id}/ack',
    tags: ['Alerts'],
    summary: 'Acknowledge an alert event',
    description:
      'Marks the event as ack-ed by the current admin and freezes future re-fires for the configured cooldown.',
    security: security({ cookie: true }),
    request: { params: idPathParams },
    responses: {
      200: jsonResponse('Acked event', successEnvelope(eventRowSchema)),
      ...standardErrors({ unauthorized: true, notFound: true }),
    },
  });
}
