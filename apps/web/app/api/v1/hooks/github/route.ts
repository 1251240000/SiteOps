import { type NextRequest } from 'next/server';

import { webhooks as webhookSvc } from '@siteops/services';

import { getBadSigBucket } from '@/lib/bad-sig-bucket';
import { getDb } from '@/lib/db';
import { getEnv } from '@/lib/env';
import { getLogger } from '@/lib/logger';
import { getOrCreateRequestId } from '@/lib/request-id';
import { renderIngestOutcome, webhookJsonError } from '@/lib/webhook-route';

export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/hooks/github — receive a GitHub webhook delivery.
 *
 * Headers we read:
 *   - `x-hub-signature-256` — `sha256=<hex>` HMAC over the raw body
 *   - `x-github-delivery`   — UUID v4 used for idempotency
 *   - `x-github-event`      — event type, e.g. `workflow_run`, `push`
 *
 * The route never calls `withApiKey*`; HMAC authentication is performed
 * inside `webhookService.verifyAndIngest`.
 */
export async function POST(req: NextRequest): Promise<Response> {
  const requestId = getOrCreateRequestId(req.headers);
  const log = getLogger().child({ requestId, route: 'hooks.github' });

  try {
    const contentType = (req.headers.get('content-type') ?? '').toLowerCase();
    if (!contentType.includes('application/json')) {
      // GitHub used to support `application/x-www-form-urlencoded`. We don't.
      return webhookJsonError(
        415,
        'unsupported_media_type',
        'webhooks require Content-Type: application/json',
        requestId,
      );
    }

    const rawBody = await req.text();
    const signature = req.headers.get('x-hub-signature-256');
    const deliveryId = req.headers.get('x-github-delivery');
    const eventType = req.headers.get('x-github-event');
    const sourceIp = req.headers.get('x-forwarded-for') ?? req.headers.get('x-real-ip');

    const env = getEnv();
    const secret = env.GH_WEBHOOK_SECRET ?? null;

    const out = await webhookSvc.webhookService.verifyAndIngest(
      { db: getDb(), logger: log, badSigBucket: getBadSigBucket() },
      {
        provider: 'github',
        secret,
        rawBody,
        signature,
        deliveryId,
        eventType,
        sourceIp: sourceIp ?? null,
      },
    );

    return renderIngestOutcome(out, requestId);
  } catch (err) {
    log.error(
      { err: { message: err instanceof Error ? err.message : String(err) } },
      'github webhook handler crashed',
    );
    return webhookJsonError(500, 'internal_error', 'Internal server error', requestId);
  }
}
