import { ok, withApi } from '@/lib/with-api';

export const dynamic = 'force-dynamic';

/** Current session info — used by the dashboard to populate the user menu. */
export const GET = withApi(async (_req, ctx) => {
  return ok({
    id: ctx.user!.id,
    email: ctx.user!.email,
    name: ctx.user!.name,
  });
});
