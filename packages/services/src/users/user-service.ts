/**
 * User service (T40).
 *
 * Manages the user lifecycle: listing, invitation, acceptance, role changes,
 * and suspension. Invitation tokens use `crypto.randomBytes(32)` →
 * `base64url`; the DB stores `sha256(token)`.
 */
import crypto from 'node:crypto';

import {
  type Db,
  userInvitationRepo,
  userRepo,
  type UserView,
  type UserListPage,
} from '@siteops/db';
import { AppError, hashPassword, type UserRole, type UserStatus } from '@siteops/shared';

import type { Logger } from '@siteops/shared';

type Ctx = { db: Db; logger: Logger };

/** Hash an invitation token for storage. */
function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/** Generate a cryptographically secure invitation token. */
function generateToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

/** Invitation validity period. */
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export const userService = {
  async list(
    ctx: Ctx,
    opts: { page?: number; limit?: number; status?: string; role?: string },
  ): Promise<UserListPage> {
    const listOpts: Parameters<typeof userRepo.list>[1] = {
      filters: { status: opts.status, role: opts.role },
    };
    if (opts.page !== undefined) listOpts.page = opts.page;
    if (opts.limit !== undefined) listOpts.limit = opts.limit;
    return userRepo.list(ctx.db, listOpts);
  },

  async getById(ctx: Ctx, id: string): Promise<UserView> {
    const user = await userRepo.getById(ctx.db, id);
    if (!user) {
      throw new AppError('User not found', { code: 'not_found', status: 404 });
    }
    return user;
  },

  /**
   * Create an invitation. Returns the raw token (for the email link) — it
   * is NOT persisted. Only the sha256 hash is stored.
   */
  async invite(
    ctx: Ctx,
    input: { email: string; role: UserRole; invitedBy: string },
  ): Promise<{
    invitation: { id: string; email: string; role: string; expiresAt: Date };
    token: string;
  }> {
    const email = input.email.trim().toLowerCase();

    // Check if user already exists
    const existing = await userRepo.getByEmail(ctx.db, email);
    if (existing) {
      throw new AppError('A user with this email already exists', {
        code: 'conflict',
        status: 409,
      });
    }

    // Check for an active pending invitation
    const pending = await userInvitationRepo.findPendingByEmail(ctx.db, email);
    if (pending) {
      throw new AppError('A pending invitation already exists for this email', {
        code: 'conflict',
        status: 409,
      });
    }

    const token = generateToken();
    const tokenHash = hashToken(token);
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS);

    const invitation = await userInvitationRepo.create(ctx.db, {
      email,
      role: input.role,
      tokenHash,
      expiresAt,
      invitedBy: input.invitedBy,
    });

    ctx.logger.info({ invitationId: invitation.id, email }, 'user invited');

    return {
      invitation: {
        id: invitation.id,
        email: invitation.email,
        role: invitation.role,
        expiresAt: invitation.expiresAt,
      },
      token,
    };
  },

  /**
   * Accept an invitation: verify the token, create the user, mark the
   * invitation as accepted.
   */
  async acceptInvitation(
    ctx: Ctx,
    input: { token: string; name: string; password: string },
  ): Promise<UserView> {
    const tokenHash = hashToken(input.token);
    const invitation = await userInvitationRepo.findPendingByTokenHash(ctx.db, tokenHash);
    if (!invitation) {
      throw new AppError('Invalid or expired invitation', {
        code: 'not_found',
        status: 404,
      });
    }

    // Double-check email uniqueness (race condition guard)
    const existing = await userRepo.getByEmail(ctx.db, invitation.email);
    if (existing) {
      throw new AppError('A user with this email already exists', {
        code: 'conflict',
        status: 409,
      });
    }

    const passwordHash = await hashPassword(input.password);
    const user = await userRepo.create(ctx.db, {
      email: invitation.email,
      passwordHash,
      name: input.name,
      role: invitation.role,
      status: 'active',
      invitedBy: invitation.invitedBy,
      invitedAt: invitation.createdAt,
    });

    await userInvitationRepo.markAccepted(ctx.db, invitation.id);
    ctx.logger.info({ userId: user.id, email: user.email }, 'invitation accepted');

    return user;
  },

  /** Update a user's role and/or status (admin only). */
  async update(
    ctx: Ctx,
    id: string,
    data: { role?: UserRole; status?: UserStatus },
  ): Promise<UserView> {
    const user = await userRepo.getById(ctx.db, id);
    if (!user) {
      throw new AppError('User not found', { code: 'not_found', status: 404 });
    }

    const updated = await userRepo.update(ctx.db, id, data);
    if (!updated) {
      throw new AppError('Update failed', { code: 'internal_error', status: 500 });
    }

    ctx.logger.info({ userId: id, changes: data }, 'user updated');
    return updated;
  },
};
