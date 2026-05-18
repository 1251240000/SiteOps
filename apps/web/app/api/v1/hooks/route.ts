import { webhooks as webhooksSvc } from '@siteops/services';
import { AppError, webhookProviderParamSchema } from '@siteops/shared';

import { getDb } from '@/lib/db';
import { ok, withApi } from '@/lib/with-api';

export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/hooks — admin list of inbound webhook deliveries.
 *
 * Query parameters (all optional):
 *   - `provider`     — `cloudflare` | `github`
 *   - `state`        — `processed` | `failed` | `pending`
 *   - `signatureOk`  — `true` | `false` (filter by HMAC verdict)
 *   - `page`         — 1-indexed
 *   - `limit`        — 1..100 (default 50)
 *
 * Returns the safe row view (full payload included — admins are trusted
 * with it, and the row is what they need to debug).
 */
export const GET = withApi(async (req, ctx) => {
  const url = new URL(req.url);
  const providerRaw = url.searchParams.get('provider');
  const provider = providerRaw ? webhookProviderParamSchema.parse(providerRaw) : undefined;
  const stateRaw = url.searchParams.get('state');
  const state =
    stateRaw === 'processed' || stateRaw === 'failed' || stateRaw === 'pending'
      ? stateRaw
      : undefined;
  const sigRaw = url.searchParams.get('signatureOk');
  const signatureOk = sigRaw === 'true' ? true : sigRaw === 'false' ? false : undefined;
  const page = Number(url.searchParams.get('page') ?? '1');
  const limit = Number(url.searchParams.get('limit') ?? '50');

  if (!Number.isFinite(page) || !Number.isFinite(limit)) {
    throw new AppError('Invalid pagination parameters', {
      code: 'validation_failed',
      status: 400,
    });
  }

  const out = await webhooksSvc.webhookService.list(
    { db: getDb(), logger: ctx.logger },
    {
      filters: {
        ...(provider ? { provider } : {}),
        ...(state ? { state } : {}),
        ...(signatureOk !== undefined ? { signatureOk } : {}),
      },
      page,
      limit,
    },
  );
  return ok(out.items, {
    meta: {
      page: out.page,
      limit: out.limit,
      total: out.total,
      totalPages: Math.max(1, Math.ceil(out.total / out.limit)),
    },
  });
});
