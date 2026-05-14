import { alerts as alertsSvc } from '@siteops/services';
import { AppError, createAlertRuleSchema } from '@siteops/shared';

import { getAlertCipher } from '@/lib/alert-cipher';
import { getDb } from '@/lib/db';
import { ok, withApi } from '@/lib/with-api';

export const dynamic = 'force-dynamic';

export const GET = withApi(async (_req, ctx) => {
  const rows = await alertsSvc.alertService.listRules({
    db: getDb(),
    cipher: getAlertCipher(),
    logger: ctx.logger,
  });
  return ok(rows);
});

export const POST = withApi(async (req, ctx) => {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new AppError('Invalid JSON body', { code: 'validation_failed', status: 400 });
  }
  const parsed = createAlertRuleSchema.safeParse(body);
  if (!parsed.success) {
    throw new AppError('Invalid request body', {
      code: 'validation_failed',
      status: 400,
      details: parsed.error.flatten(),
    });
  }
  const row = await alertsSvc.alertService.createRule(
    { db: getDb(), cipher: getAlertCipher(), logger: ctx.logger },
    parsed.data,
  );
  return ok(row, { status: 201 });
});
