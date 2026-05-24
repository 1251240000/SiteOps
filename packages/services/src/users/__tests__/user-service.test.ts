import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { users, userInvitations } from '@siteops/db';
import { createTestDb, type TestDbHandle } from '@siteops/db/testing';
import { hashPassword, comparePassword } from '@siteops/shared';

import { userService } from '../user-service.js';

let handle: TestDbHandle;

const silentLogger = {
  trace: () => {},
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  fatal: () => {},
  child: () => silentLogger,
};

const deps = () => ({ db: handle.db as never, logger: silentLogger as never });

async function seedAdmin(): Promise<string> {
  const [row] = await handle.db
    .insert(users)
    .values({
      email: 'admin@example.com',
      passwordHash: await hashPassword('admin-pass-1234'),
      name: 'Admin',
      role: 'admin',
      status: 'active',
    })
    .returning({ id: users.id });
  if (!row) throw new Error('seedAdmin');
  return row.id;
}

describe('userService', () => {
  beforeEach(async () => {
    if (!handle) handle = await createTestDb();
    await handle.reset();
  });

  afterAll(async () => {
    if (handle) await handle.close();
  });

  describe('invite', () => {
    it('creates a pending invitation and returns a raw token (not stored)', async () => {
      const adminId = await seedAdmin();
      const { invitation, token } = await userService.invite(deps(), {
        email: 'newbie@example.com',
        role: 'operator',
        invitedBy: adminId,
      });

      expect(invitation.email).toBe('newbie@example.com');
      expect(invitation.role).toBe('operator');
      expect(invitation.expiresAt.getTime()).toBeGreaterThan(Date.now());
      expect(token).toMatch(/^[A-Za-z0-9_-]+$/); // base64url
      expect(token.length).toBeGreaterThan(20);

      const rows = await handle.db.select().from(userInvitations);
      expect(rows).toHaveLength(1);
      // Raw token must NOT be persisted — only its sha256 hash.
      expect(rows[0]?.tokenHash).not.toBe(token);
      expect(rows[0]?.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('lowercases & trims email before persistence', async () => {
      const adminId = await seedAdmin();
      const { invitation } = await userService.invite(deps(), {
        email: '  Mixed@Example.com ',
        role: 'viewer',
        invitedBy: adminId,
      });
      expect(invitation.email).toBe('mixed@example.com');
    });

    it('rejects when an active user already exists with that email', async () => {
      const adminId = await seedAdmin();
      await expect(
        userService.invite(deps(), {
          email: 'admin@example.com',
          role: 'viewer',
          invitedBy: adminId,
        }),
      ).rejects.toMatchObject({ code: 'conflict', status: 409 });
    });

    it('rejects when a pending invitation already exists for that email', async () => {
      const adminId = await seedAdmin();
      await userService.invite(deps(), {
        email: 'pending@example.com',
        role: 'viewer',
        invitedBy: adminId,
      });
      await expect(
        userService.invite(deps(), {
          email: 'pending@example.com',
          role: 'operator',
          invitedBy: adminId,
        }),
      ).rejects.toMatchObject({ code: 'conflict' });
    });
  });

  describe('acceptInvitation', () => {
    it('creates an active user with the invited role and a valid bcrypt password', async () => {
      const adminId = await seedAdmin();
      const { token } = await userService.invite(deps(), {
        email: 'accept@example.com',
        role: 'operator',
        invitedBy: adminId,
      });

      const user = await userService.acceptInvitation(deps(), {
        token,
        name: 'Accepted User',
        password: 'accept-pass-1234',
      });

      expect(user.email).toBe('accept@example.com');
      expect(user.role).toBe('operator');
      expect(user.status).toBe('active');
      expect(user.invitedBy).toBe(adminId);

      // Round-trip the password to confirm the hash is real bcrypt.
      const [row] = await handle.db
        .select({ passwordHash: users.passwordHash })
        .from(users)
        .where(eq(users.id, user.id));
      expect(await comparePassword('accept-pass-1234', row?.passwordHash ?? '')).toBe(true);
    });

    it('marks the invitation accepted (single-use)', async () => {
      const adminId = await seedAdmin();
      const { token } = await userService.invite(deps(), {
        email: 'oneshot@example.com',
        role: 'viewer',
        invitedBy: adminId,
      });
      await userService.acceptInvitation(deps(), {
        token,
        name: 'OS',
        password: 'pw-1234567',
      });
      // Reusing the same token must now fail (already accepted).
      await expect(
        userService.acceptInvitation(deps(), {
          token,
          name: 'OS2',
          password: 'pw-1234567',
        }),
      ).rejects.toMatchObject({ code: 'not_found' });
    });

    it('rejects an unknown / tampered token', async () => {
      await expect(
        userService.acceptInvitation(deps(), {
          token: 'not-a-real-token',
          name: 'X',
          password: 'pw-1234567',
        }),
      ).rejects.toMatchObject({ code: 'not_found', status: 404 });
    });
  });

  describe('update', () => {
    it('changes the role of an existing user', async () => {
      const adminId = await seedAdmin();
      const { token } = await userService.invite(deps(), {
        email: 'role@example.com',
        role: 'viewer',
        invitedBy: adminId,
      });
      const user = await userService.acceptInvitation(deps(), {
        token,
        name: 'R',
        password: 'pw-1234567',
      });

      const updated = await userService.update(deps(), user.id, { role: 'operator' });
      expect(updated.role).toBe('operator');
      expect(updated.status).toBe('active'); // status unchanged
    });

    it('suspends and reactivates a user', async () => {
      const adminId = await seedAdmin();
      const { token } = await userService.invite(deps(), {
        email: 'susp@example.com',
        role: 'viewer',
        invitedBy: adminId,
      });
      const user = await userService.acceptInvitation(deps(), {
        token,
        name: 'S',
        password: 'pw-1234567',
      });

      const suspended = await userService.update(deps(), user.id, { status: 'suspended' });
      expect(suspended.status).toBe('suspended');
      expect(suspended.role).toBe('viewer'); // role unchanged

      const reactivated = await userService.update(deps(), user.id, { status: 'active' });
      expect(reactivated.status).toBe('active');
    });

    it('throws 404 for unknown user id', async () => {
      await expect(
        userService.update(deps(), '00000000-0000-0000-0000-000000000000', { role: 'viewer' }),
      ).rejects.toMatchObject({ code: 'not_found', status: 404 });
    });
  });

  describe('list / getById', () => {
    it('returns paginated rows with newest-first ordering', async () => {
      const adminId = await seedAdmin();
      // Stagger so the createdAt order is deterministic on the millisecond clock.
      for (const email of ['a@a.com', 'b@b.com', 'c@c.com']) {
        const { token } = await userService.invite(deps(), {
          email,
          role: 'viewer',
          invitedBy: adminId,
        });
        await userService.acceptInvitation(deps(), {
          token,
          name: email,
          password: 'pw-1234567',
        });
        await new Promise((r) => setTimeout(r, 5));
      }

      const page = await userService.list(deps(), { page: 1, limit: 10 });
      expect(page.total).toBe(4); // admin + 3 invitees
      expect(page.items[0]?.email).toBe('c@c.com'); // newest first
    });

    it('filters by role', async () => {
      const adminId = await seedAdmin();
      const { token } = await userService.invite(deps(), {
        email: 'op@op.com',
        role: 'operator',
        invitedBy: adminId,
      });
      await userService.acceptInvitation(deps(), {
        token,
        name: 'OP',
        password: 'pw-1234567',
      });

      const adminsOnly = await userService.list(deps(), { role: 'admin' });
      expect(adminsOnly.items.every((u) => u.role === 'admin')).toBe(true);
      expect(adminsOnly.items.length).toBe(1);

      const opsOnly = await userService.list(deps(), { role: 'operator' });
      expect(opsOnly.items.every((u) => u.role === 'operator')).toBe(true);
    });

    it('getById throws 404 for unknown id', async () => {
      await expect(
        userService.getById(deps(), '00000000-0000-0000-0000-000000000000'),
      ).rejects.toMatchObject({ code: 'not_found' });
    });
  });
});
