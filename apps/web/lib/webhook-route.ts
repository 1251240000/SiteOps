/**
 * Helpers shared by the T27 webhook routes:
 *
 *   - `renderIngestOutcome(out, requestId)` → maps a `webhookService` result
 *     into the canonical 2xx / 4xx / 5xx envelope this codebase uses.
 *   - `webhookJsonError(...)`                → same shape as `with-api.ts`'s
 *     internal helper, but exported for the webhook routes which don't go
 *     through `withApi*`.
 *
 * Keeping these in a dedicated module (instead of inline in each route) means
 * the response envelope stays in lock-step across both providers.
 */
import { NextResponse } from 'next/server';

import type { webhooks as WebhooksNs } from '@siteops/services';

export type IngestOutcome = Awaited<ReturnType<typeof WebhooksNs.webhookService.verifyAndIngest>>;

export function webhookJsonError(
  status: number,
  code: string,
  message: string,
  requestId: string,
  details?: Record<string, unknown>,
): NextResponse {
  const error: {
    code: string;
    message: string;
    requestId: string;
    details?: Record<string, unknown>;
  } = { code, message, requestId };
  if (details) error.details = details;
  const res = NextResponse.json({ error }, { status });
  res.headers.set('x-request-id', requestId);
  return res;
}

export function renderIngestOutcome(out: IngestOutcome, requestId: string): NextResponse {
  switch (out.kind) {
    case 'not_configured':
      return webhookJsonError(
        503,
        'webhook_not_configured',
        'Webhook secret not set for this provider',
        requestId,
      );
    case 'bad_request':
      return webhookJsonError(400, 'validation_failed', `Bad request: ${out.reason}`, requestId);
    case 'unauthorized':
      return webhookJsonError(
        401,
        'unauthorized',
        'Invalid webhook signature',
        requestId,
        out.eventId ? { eventId: out.eventId } : undefined,
      );
    case 'rate_limited':
      return webhookJsonError(
        401,
        'unauthorized',
        'Too many invalid signatures from this source',
        requestId,
      );
    case 'accepted': {
      const status = out.duplicate ? 200 : 202;
      const body: {
        data: { id: string; duplicate: boolean };
        meta?: Record<string, unknown>;
      } = {
        data: { id: out.event.id, duplicate: out.duplicate },
      };
      if (out.dispatchFailed) body.meta = { dispatch_failed: true };
      const res = NextResponse.json(body, { status });
      res.headers.set('x-request-id', requestId);
      return res;
    }
  }
}
