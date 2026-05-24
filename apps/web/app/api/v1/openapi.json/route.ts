import { NextResponse } from 'next/server';

import { buildOpenApiDocument } from '@/lib/openapi/build';

export const dynamic = 'force-static';

/**
 * GET /api/v1/openapi.json — serves the OpenAPI 3.1 document covering every
 * v1 route. Built from the registry in `lib/openapi/*` so the spec stays in
 * lock-step with handler code.
 */
export function GET() {
  const doc = buildOpenApiDocument();
  return NextResponse.json(doc, {
    headers: {
      'cache-control': 'public, max-age=60, stale-while-revalidate=600',
    },
  });
}
