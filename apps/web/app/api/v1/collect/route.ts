import { type NextRequest, NextResponse } from 'next/server';

import { analytics as analyticsSvc } from '@siteops/services';

import { getDb } from '@/lib/db';
import { withPublic } from '@/lib/with-api';

export const dynamic = 'force-dynamic';

function corsHeaders(origin: string | null): HeadersInit {
  return {
    'access-control-allow-origin': origin ?? '*',
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-max-age': '86400',
    vary: 'origin',
  };
}

export function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req.headers.get('origin')) });
}

/** POST /api/v1/collect — public browser analytics ingestion endpoint. */
export const POST = withPublic(async (req, ctx) => {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const origin = req.headers.get('origin');
  const result = await analyticsSvc.analyticsCollectService.collect(getDb(), body, origin);
  ctx.logger.info(
    { siteId: result.siteId, accepted: result.accepted },
    'analytics collect accepted',
  );
  return NextResponse.json(
    { data: { accepted: result.accepted } },
    { status: 202, headers: corsHeaders(origin) },
  );
});
