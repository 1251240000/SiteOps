import { alerts as alertsSvc } from '@siteops/services';
import { AppError, createAlertChannelSchema } from '@siteops/shared';

import { getAlertCipher } from '@/lib/alert-cipher';
import { getDb } from '@/lib/db';
import { ok, withApi } from '@/lib/with-api';

export const dynamic = 'force-dynamic';

function safeChannel<T extends { config: unknown }>(
  row: T,
): Omit<T, 'config'> & { config: { type: 'encrypted' } } {
  const { config: _omit, ...rest } = row;
  void _omit;
  return { ...rest, config: { type: 'encrypted' as const } };
}

export const GET = withApi(async (_req, ctx) => {
  const rows = await alertsSvc.alertService.listChannels({
    db: getDb(),
    cipher: getAlertCipher(),
    logger: ctx.logger,
  });
  return ok(rows.map(safeChannel));
});

export const POST = withApi(
  async (req, ctx) => {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      throw new AppError('Invalid JSON body', { code: 'validation_failed', status: 400 });
    }
    const parsed = createAlertChannelSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError('Invalid request body', {
        code: 'validation_failed',
        status: 400,
        details: parsed.error.flatten(),
      });
    }
    const row = await alertsSvc.alertService.createChannel(
      { db: getDb(), cipher: getAlertCipher(), logger: ctx.logger },
      parsed.data,
    );
    return ok(safeChannel(row), { status: 201 });
  },
  { permission: 'alerts.write' },
);
