import { type NextRequest } from 'next/server';

import { alerts as alertsSvc } from '@siteops/services';
import { AppError, idSchema, updateAlertChannelSchema } from '@siteops/shared';

import { getAlertCipher } from '@/lib/alert-cipher';
import { getDb } from '@/lib/db';
import { ok, withApi } from '@/lib/with-api';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

async function readId(routeCtx: RouteContext): Promise<string> {
  const { id } = await routeCtx.params;
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) {
    throw new AppError('Invalid channel id', { code: 'validation_failed', status: 400 });
  }
  return parsed.data;
}

export function GET(req: NextRequest, routeCtx: RouteContext) {
  return withApi(async (_req, ctx) => {
    const id = await readId(routeCtx);
    const row = await alertsSvc.alertService.getChannelWithConfig(
      { db: getDb(), cipher: getAlertCipher(), logger: ctx.logger },
      id,
    );
    return ok(row);
  })(req);
}

export function PATCH(req: NextRequest, routeCtx: RouteContext) {
  return withApi(async (request, ctx) => {
    const id = await readId(routeCtx);
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new AppError('Invalid JSON body', { code: 'validation_failed', status: 400 });
    }
    const parsed = updateAlertChannelSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError('Invalid request body', {
        code: 'validation_failed',
        status: 400,
        details: parsed.error.flatten(),
      });
    }
    const row = await alertsSvc.alertService.updateChannel(
      { db: getDb(), cipher: getAlertCipher(), logger: ctx.logger },
      id,
      parsed.data,
    );
    return ok({ ...row, config: { type: 'encrypted' } });
  })(req);
}

export function DELETE(req: NextRequest, routeCtx: RouteContext) {
  return withApi(async (_req, ctx) => {
    const id = await readId(routeCtx);
    const row = await alertsSvc.alertService.deleteChannel(
      { db: getDb(), cipher: getAlertCipher(), logger: ctx.logger },
      id,
    );
    return ok({ ...row, config: { type: 'encrypted' } });
  })(req);
}
