import { users as userSvc } from '@siteops/services';
import { AppError, createInvitationSchema } from '@siteops/shared';

import { getDb } from '@/lib/db';
import { ok, requirePermission } from '@/lib/with-api';

export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/users/invitations — create a user invitation.
 *
 * Returns the public link including the raw token. The token itself is NOT
 * persisted (only its sha256 hash is). Email delivery is intentionally
 * out-of-scope for T40 — the link can be copied from the response or the
 * audit log and shared manually.
 */
export const POST = requirePermission('users.write', async (req, ctx) => {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new AppError('Invalid JSON body', { code: 'validation_failed', status: 400 });
  }
  const parsed = createInvitationSchema.safeParse(body);
  if (!parsed.success) {
    throw new AppError('Invalid request body', {
      code: 'validation_failed',
      status: 400,
      details: parsed.error.flatten(),
    });
  }

  if (!ctx.user) {
    throw new AppError('Authentication required', { code: 'unauthorized', status: 401 });
  }

  const result = await userSvc.userService.invite(
    { db: getDb(), logger: ctx.logger },
    {
      email: parsed.data.email,
      role: parsed.data.role,
      invitedBy: ctx.user.id,
    },
  );

  // Build the public acceptance URL the admin can share. We use the request
  // origin so the link works regardless of the deployment domain.
  const base = new URL(req.url).origin;
  const inviteUrl = `${base.replace(/\/$/, '')}/invite/${result.token}`;

  return ok(
    {
      invitation: result.invitation,
      inviteUrl,
    },
    { status: 201 },
  );
});
