/**
 * User invitations repository (T40).
 *
 * Handles CRUD for the `user_invitations` table. Token hashing is the
 * service layer's responsibility — this repo stores and queries pre-hashed
 * values only.
 */
import { and, eq, isNull, sql } from 'drizzle-orm';

import type { Db } from '../client.js';
import {
  userInvitations,
  type NewUserInvitation,
  type UserInvitation,
} from '../schema/user-invitations.js';

export const userInvitationRepo = {
  async create(db: Db, input: NewUserInvitation): Promise<UserInvitation> {
    const rows = await db.insert(userInvitations).values(input).returning();
    const row = rows[0];
    if (!row) throw new Error('userInvitationRepo.create: insert returned no row');
    return row;
  },

  /** Find a pending (not yet accepted, not expired) invitation by token hash. */
  async findPendingByTokenHash(db: Db, tokenHash: string): Promise<UserInvitation | null> {
    const rows = await db
      .select()
      .from(userInvitations)
      .where(
        and(
          eq(userInvitations.tokenHash, tokenHash),
          isNull(userInvitations.acceptedAt),
          sql`${userInvitations.expiresAt} > now()`,
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  },

  /** Find any pending invitation for a given email (to detect duplicates). */
  async findPendingByEmail(db: Db, email: string): Promise<UserInvitation | null> {
    const rows = await db
      .select()
      .from(userInvitations)
      .where(
        and(
          eq(userInvitations.email, email.trim().toLowerCase()),
          isNull(userInvitations.acceptedAt),
          sql`${userInvitations.expiresAt} > now()`,
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  },

  /** Mark an invitation as accepted. */
  async markAccepted(db: Db, id: string): Promise<void> {
    await db
      .update(userInvitations)
      .set({ acceptedAt: new Date() })
      .where(eq(userInvitations.id, id));
  },
};
