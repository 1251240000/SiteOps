/**
 * React-Query keys + wire types for the /webhooks dashboard.
 */
export type WebhookProvider = 'cloudflare' | 'github';
export type WebhookListState = 'processed' | 'failed' | 'pending';

export type WebhookEventRow = {
  id: string;
  provider: WebhookProvider;
  eventType: string;
  deliveryId: string;
  signatureOk: boolean;
  payload: Record<string, unknown>;
  siteId: string | null;
  processedAt: string | null;
  error: string | null;
  attempts: number;
  createdAt: string;
};

export type ReplayResponse = {
  event: {
    id: string;
    provider: WebhookProvider;
    eventType: string;
    deliveryId: string;
    processedAt: string | null;
    error: string | null;
    attempts: number;
  };
  dispatchFailed: boolean;
  error?: string;
};

export const webhooksKeys = {
  all: ['webhooks'] as const,
  lists: () => [...webhooksKeys.all, 'list'] as const,
  list: (query: Record<string, unknown>) => [...webhooksKeys.lists(), query] as const,
};
