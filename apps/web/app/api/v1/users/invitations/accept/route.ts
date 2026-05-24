import { users as userSvc } from '@siteops/services';
import { AppError, acceptInvitationSchema } from '@siteops/shared';

import { getDb } from '@/lib/db';
import { ok, withPublic } from '@/lib/with-api';

export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/users/invitations/accept — public.
 *
 * Verifies the invitation token (single-use, expires after 7 days), creates
 * the user with the chosen password, and marks the invitation as accepted.
 * The caller must still log in afterwards via the standard credentials flow.
 */
export const POST = withPublic(async (req, ctx) => {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new AppError('Invalid JSON body', { code: 'validation_failed', status: 400 });
  }
  const parsed = acceptInvitationSchema.safeParse(body);
  if (!parsed.success) {
    throw new AppError('Invalid request body', {
      code: 'validation_failed',
      status: 400,
      details: parsed.error.flatten(),
    });
  }

  const user = await userSvc.userService.acceptInvitation(
    { db: getDb(), logger: ctx.logger },
    parsed.data,
  );
  return ok(user, { status: 201 });
});
