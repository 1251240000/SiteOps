import { alerts as alertsSvc } from '@siteops/services';
import { AppError, idSchema } from '@siteops/shared';

import { getAlertCipher } from '@/lib/alert-cipher';
import { getDb } from '@/lib/db';
import { ok, withApi } from '@/lib/with-api';

export const dynamic = 'force-dynamic';

export const GET = withApi(async (req, ctx) => {
  const url = new URL(req.url);
  const status = url.searchParams.get('status');
  const siteId = url.searchParams.get('siteId');
  if (siteId) {
    const sid = idSchema.safeParse(siteId);
    if (!sid.success) {
      throw new AppError('Invalid siteId', { code: 'validation_failed', status: 400 });
    }
  }
  const page = Math.max(1, Number.parseInt(url.searchParams.get('page') ?? '1', 10) || 1);
  const limit = Math.min(
    100,
    Math.max(1, Number.parseInt(url.searchParams.get('limit') ?? '20', 10) || 20),
  );
  const result = await alertsSvc.alertService.listAlerts(
    { db: getDb(), cipher: getAlertCipher(), logger: ctx.logger },
    {
      ...(status === 'firing' || status === 'resolved' ? { status } : {}),
      ...(siteId ? { siteId } : {}),
      page,
      limit,
    },
  );
  return ok(result.items, {
    meta: {
      page: result.page,
      limit: result.limit,
      total: result.total,
      totalPages: Math.max(1, Math.ceil(result.total / result.limit)),
    },
  });
});
