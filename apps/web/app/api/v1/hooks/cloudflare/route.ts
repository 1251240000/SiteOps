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
 * POST /api/v1/hooks/cloudflare — receive a Cloudflare Notification API delivery.
 *
 * Headers we read:
 *   - `cf-webhook-auth` — HMAC-SHA256 over the raw body, hex-encoded
 *   - `cf-webhook-id`   — unique delivery id used for idempotency
 *   - `cf-webhook-name` — event type, e.g. `deployment.success`
 *
 * The route does **not** call any `withApiKey*` wrapper because webhooks
 * authenticate with HMAC, not a Bearer token.
 */
export async function POST(req: NextRequest): Promise<Response> {
  const requestId = getOrCreateRequestId(req.headers);
  const log = getLogger().child({ requestId, route: 'hooks.cloudflare' });

  try {
    // Force JSON: Cloudflare always ships application/json; anything else
    // is either a misconfigured webhook or someone testing manually.
    const contentType = (req.headers.get('content-type') ?? '').toLowerCase();
    if (!contentType.includes('application/json')) {
      return webhookJsonError(
        415,
        'unsupported_media_type',
        'webhooks require Content-Type: application/json',
        requestId,
      );
    }

    const rawBody = await req.text();
    const signature = req.headers.get('cf-webhook-auth');
    const deliveryId = req.headers.get('cf-webhook-id');
    const eventType = req.headers.get('cf-webhook-name');
    const sourceIp = req.headers.get('x-forwarded-for') ?? req.headers.get('x-real-ip');

    const env = getEnv();
    const secret = env.CF_WEBHOOK_SECRET ?? null;

    const out = await webhookSvc.webhookService.verifyAndIngest(
      { db: getDb(), logger: log, badSigBucket: getBadSigBucket() },
      {
        provider: 'cloudflare',
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
      'cloudflare webhook handler crashed',
    );
    return webhookJsonError(500, 'internal_error', 'Internal server error', requestId);
  }
}
