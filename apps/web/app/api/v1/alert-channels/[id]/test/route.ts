import { type NextRequest } from 'next/server';

import { alerts as alertsSvc } from '@siteops/services';
import { AppError, idSchema, testChannelSchema } from '@siteops/shared';

import { getAlertCipher } from '@/lib/alert-cipher';
import { getDb } from '@/lib/db';
import { ok, withApi } from '@/lib/with-api';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

export function POST(req: NextRequest, routeCtx: RouteContext) {
  return withApi(
    async (request, ctx) => {
      const { id } = await routeCtx.params;
      const parsedId = idSchema.safeParse(id);
      if (!parsedId.success) {
        throw new AppError('Invalid channel id', { code: 'validation_failed', status: 400 });
      }
      let body: unknown = {};
      try {
        body = await request.json();
      } catch {
        body = {};
      }
      const parsed = testChannelSchema.safeParse(body);
      if (!parsed.success) {
        throw new AppError('Invalid request body', {
          code: 'validation_failed',
          status: 400,
          details: parsed.error.flatten(),
        });
      }
      const res = await alertsSvc.alertService.testChannel(
        { db: getDb(), cipher: getAlertCipher(), logger: ctx.logger },
        parsedId.data,
        parsed.data.message ?? 'siteops · channel test',
      );
      return ok(res);
    },
    { permission: 'alerts.write' },
  )(req);
}
