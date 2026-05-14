/**
 * Zod schemas for the alerts API (T16).
 *
 * Includes:
 *   - Alert rule: which metric, threshold, channels
 *   - Alert channel: webhook / feishu / dingtalk / slack / telegram / email
 */
import { z } from 'zod';

import {
  ALERT_CHANNEL_TYPES,
  ALERT_METRICS,
  ALERT_OPERATORS,
  ALERT_SCOPES,
} from '../constants/alert.js';

import { idSchema } from './common.js';

export const alertChannelConfigSchema = z
  .record(z.unknown())
  .refine((m) => JSON.stringify(m).length <= 8 * 1024, {
    message: 'config must be <= 8 KiB when serialised',
  });

export const createAlertChannelSchema = z.object({
  name: z.string().trim().min(1).max(80),
  type: z.enum(ALERT_CHANNEL_TYPES),
  config: alertChannelConfigSchema,
  enabled: z.boolean().default(true),
});
export type CreateAlertChannelInput = z.infer<typeof createAlertChannelSchema>;

export const updateAlertChannelSchema = createAlertChannelSchema.partial();
export type UpdateAlertChannelInput = z.infer<typeof updateAlertChannelSchema>;

export const createAlertRuleSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    scope: z.enum(ALERT_SCOPES),
    siteId: idSchema.optional(),
    metric: z.enum(ALERT_METRICS),
    operator: z.enum(ALERT_OPERATORS),
    threshold: z.number().finite(),
    windowMinutes: z
      .number()
      .int()
      .min(1)
      .max(60 * 24)
      .optional(),
    consecutive: z.number().int().min(1).max(50).default(1),
    enabled: z.boolean().default(true),
    channelIds: z.array(idSchema).max(20).default([]),
  })
  .superRefine((data, ctx) => {
    if (data.scope === 'site' && !data.siteId) {
      ctx.addIssue({
        code: 'custom',
        path: ['siteId'],
        message: 'site-scoped rules must specify siteId',
      });
    }
    if (data.scope === 'global' && data.siteId) {
      ctx.addIssue({
        code: 'custom',
        path: ['siteId'],
        message: 'global rules must not specify siteId',
      });
    }
  });
export type CreateAlertRuleInput = z.infer<typeof createAlertRuleSchema>;

export const updateAlertRuleSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    metric: z.enum(ALERT_METRICS).optional(),
    operator: z.enum(ALERT_OPERATORS).optional(),
    threshold: z.number().finite().optional(),
    windowMinutes: z
      .number()
      .int()
      .min(1)
      .max(60 * 24)
      .optional(),
    consecutive: z.number().int().min(1).max(50).optional(),
    enabled: z.boolean().optional(),
    channelIds: z.array(idSchema).max(20).optional(),
  })
  .strict();
export type UpdateAlertRuleInput = z.infer<typeof updateAlertRuleSchema>;

export const testChannelSchema = z
  .object({
    message: z.string().trim().min(1).max(500).optional(),
  })
  .strict();
export type TestChannelInput = z.infer<typeof testChannelSchema>;
