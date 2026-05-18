import { agents as agentsSvc } from '@siteops/services';
import { AppError, agentRunSummaryQuerySchema } from '@siteops/shared';

import { getDb } from '@/lib/db';
import { ok, withApi } from '@/lib/with-api';

export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/agent-runs/summary — aggregated KPI card for the dashboard.
 *
 * Returns counts (total / succeeded / failed / activeKeys) and latency
 * percentiles (p50 / p95) over an optional `[from, to]` window. The window
 * defaults to "all rows" when both are omitted; the dashboard always sends
 * a 7-day window so the response stays bounded.
 */
export const GET = withApi(async (req, ctx) => {
  const url = new URL(req.url);
  const raw: Record<string, string> = {};
  for (const key of url.searchParams.keys()) {
    raw[key] = url.searchParams.get(key) ?? '';
  }
  const parsed = agentRunSummaryQuerySchema.safeParse(raw);
  if (!parsed.success) {
    throw new AppError('Invalid query parameters', {
      code: 'validation_failed',
      status: 400,
      details: parsed.error.flatten(),
    });
  }
  const summary = await agentsSvc.agentRunService.summary(
    { db: getDb(), logger: ctx.logger },
    {
      from: parsed.data.from ? new Date(parsed.data.from) : undefined,
      to: parsed.data.to ? new Date(parsed.data.to) : undefined,
    },
  );
  return ok(summary);
});
