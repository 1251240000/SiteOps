/** Notifier dispatcher. Each channel type → its notifier implementation. */
import { dingtalkNotifier } from './dingtalk.js';
import { emailNotifier } from './email.js';
import { feishuNotifier } from './feishu.js';
import { slackNotifier } from './slack.js';
import { telegramNotifier } from './telegram.js';
import { webhookNotifier } from './webhook.js';

import type { AlertNotification, Notifier, NotifyResult } from './types.js';

export type ChannelType = 'webhook' | 'email' | 'feishu' | 'dingtalk' | 'slack' | 'telegram';

const REGISTRY: Record<ChannelType, Notifier> = {
  webhook: webhookNotifier,
  email: emailNotifier,
  feishu: feishuNotifier,
  dingtalk: dingtalkNotifier,
  slack: slackNotifier,
  telegram: telegramNotifier,
};

export function getNotifier(type: ChannelType): Notifier {
  const n = REGISTRY[type];
  if (!n) throw new Error(`unknown channel type: ${type}`);
  return n;
}

export async function notify(
  type: ChannelType,
  alert: AlertNotification,
  config: Record<string, unknown>,
): Promise<NotifyResult> {
  return getNotifier(type)({ alert, config });
}

export * from './types.js';
export { webhookNotifier } from './webhook.js';
export { feishuNotifier } from './feishu.js';
export { dingtalkNotifier } from './dingtalk.js';
export { slackNotifier } from './slack.js';
export { telegramNotifier } from './telegram.js';
export { emailNotifier } from './email.js';
