import { webhooks as webhooksSvc } from '@siteops/services';
import { AppError, decodeCursor, webhookProviderParamSchema } from '@siteops/shared';

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
 *   - `page`         — 1-indexed (legacy offset path)
 *   - `cursor`       — opaque base64url keyset cursor (T36)
 *   - `limit`        — 1..100 (default 50)
 *
 * When `cursor` is set, `page` is ignored and the response meta becomes
 * `{ cursor: { next }, hasMore, limit }`. Otherwise the legacy
 * `{ page, limit, total, totalPages }` envelope is returned unchanged.
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
  const cursorRaw = url.searchParams.get('cursor');

  if (!Number.isFinite(page) || !Number.isFinite(limit)) {
    throw new AppError('Invalid pagination parameters', {
      code: 'validation_failed',
      status: 400,
    });
  }

  let cursor;
  if (cursorRaw) {
    cursor = decodeCursor(cursorRaw);
    if (!cursor) {
      throw new AppError('Invalid cursor', {
        code: 'validation_failed',
        status: 400,
        details: { cursor: 'malformed or expired' },
      });
    }
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
      ...(cursor ? { cursor } : {}),
    },
  );
  if (cursor) {
    return ok(out.items, {
      meta: {
        cursor: { next: out.nextCursor },
        hasMore: out.hasMore,
        limit: out.limit,
      },
    });
  }
  // Offset mode also exposes a forward cursor so a client can switch
  // to keyset mode after page 1 without an awkward bootstrap.
  return ok(out.items, {
    meta: {
      page: out.page,
      limit: out.limit,
      total: out.total,
      totalPages: Math.max(1, Math.ceil(out.total / out.limit)),
      cursor: { next: out.nextCursor },
      hasMore: out.hasMore,
    },
  });
});
