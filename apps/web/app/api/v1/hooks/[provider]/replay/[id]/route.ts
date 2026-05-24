import { type NextRequest } from 'next/server';

import { webhooks as webhookSvc } from '@siteops/services';
import { AppError, webhookProviderParamSchema } from '@siteops/shared';

import { getDb } from '@/lib/db';
import { ok, withApi } from '@/lib/with-api';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ provider: string; id: string }> };

/**
 * POST /api/v1/hooks/:provider/replay/:id — admin-only re-dispatch of a
 * previously stored webhook event. The signature is **not** re-checked
 * (payload already lives in our DB and is trusted); the route only exists
 * to recover after a downstream `deploymentService` outage.
 *
 * Returns `{ data: { event, dispatchFailed, error? } }` with status 200 on
 * success, mirroring the audit row that `webhookService.replay` upserts.
 */
export function POST(req: NextRequest, routeCtx: RouteContext) {
  return withApi(
    async (_req, apiCtx) => {
      const { provider, id } = await routeCtx.params;

      const providerParsed = webhookProviderParamSchema.safeParse(provider);
      if (!providerParsed.success) {
        throw new AppError('Unknown webhook provider', {
          code: 'validation_failed',
          status: 400,
          details: { provider },
        });
      }

      if (!/^[0-9a-f-]{36}$/i.test(id)) {
        throw new AppError('Invalid event id', {
          code: 'validation_failed',
          status: 400,
          details: { id },
        });
      }

      const result = await webhookSvc.webhookService.replay(
        { db: getDb(), logger: apiCtx.logger },
        id,
      );

      // We enforce the URL-path provider matches the row provider so an admin
      // can't accidentally replay a CF event via the /github/ path. The service
      // itself already dispatches against the row's own provider; this is a
      // safety check for the URL contract.
      if (result.event.provider !== providerParsed.data) {
        throw new AppError('Provider mismatch between path and event', {
          code: 'validation_failed',
          status: 400,
          details: { pathProvider: providerParsed.data, eventProvider: result.event.provider },
        });
      }

      return ok({
        event: {
          id: result.event.id,
          provider: result.event.provider,
          eventType: result.event.eventType,
          deliveryId: result.event.deliveryId,
          processedAt: result.event.processedAt,
          error: result.event.error,
          attempts: result.event.attempts,
        },
        dispatchFailed: result.dispatchFailed,
        ...(result.error ? { error: result.error } : {}),
      });
    },
    { permission: 'webhooks.write' },
  )(req);
}
