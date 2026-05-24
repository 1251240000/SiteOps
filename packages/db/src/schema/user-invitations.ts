import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { createdAt } from './_helpers.js';
import { users } from './users.js';

export const userInvitations = pgTable('user_invitations', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull(),
  role: text('role').notNull().default('viewer'),
  tokenHash: text('token_hash').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
  acceptedAt: timestamp('accepted_at', { withTimezone: true, mode: 'date' }),
  invitedBy: uuid('invited_by')
    .notNull()
    .references(() => users.id),
  createdAt: createdAt(),
});

export type UserInvitation = typeof userInvitations.$inferSelect;
export type NewUserInvitation = typeof userInvitations.$inferInsert;
