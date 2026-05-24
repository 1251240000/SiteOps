/**
 * Route-handler tests for `/api/v1/users` and `/api/v1/users/invitations`.
 *
 * Covers:
 *   - Auth gate: 401 without a session
 *   - RBAC: 403 for non-admin (operator / viewer) callers
 *   - Happy path: invite → accept → list → patch round-trip
 *   - Self-modification guards
 *   - Validation 400s
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));
vi.mock('@/lib/db', () => ({ getDb: vi.fn() }));

import { users } from '@siteops/db';
import { hashPassword } from '@siteops/shared';

import { GET as listUsers } from '@/app/api/v1/users/route';
import { GET as getUser, PATCH as patchUser } from '@/app/api/v1/users/[id]/route';
import { POST as createInvitation } from '@/app/api/v1/users/invitations/route';
import { POST as acceptInvitation } from '@/app/api/v1/users/invitations/accept/route';

import {
  bindDbMock,
  buildRequest,
  FAKE_SESSION,
  readJson,
  resetDb,
  routeContext,
  setSession,
  setupTestDb,
} from '@/__tests__/helpers';

type UserRole = 'admin' | 'operator' | 'viewer';

function sessionWithRole(role: UserRole, id = FAKE_SESSION.user.id) {
  return {
    user: { id, email: `${role}@test.local`, name: role, role },
    expires: new Date(Date.now() + 86_400_000).toISOString(),
  };
}

/**
 * Seed the FAKE_SESSION admin into the users table so that invitations'
 * `invited_by` FK resolves. Uses the same id the session reports.
 */
async function seedSessionAdmin(): Promise<void> {
  const handle = await setupTestDb();
  await handle.db.insert(users).values({
    id: FAKE_SESSION.user.id,
    email: FAKE_SESSION.user.email,
    passwordHash: await hashPassword('admin-test-pw-1234'),
    name: 'Admin',
    role: 'admin',
    status: 'active',
  });
}

beforeAll(async () => {
  await setupTestDb();
  await bindDbMock();
});

beforeEach(async () => {
  await resetDb();
  await seedSessionAdmin();
  await setSession(sessionWithRole('admin'));
});

afterAll(() => {
  vi.restoreAllMocks();
});

describe('POST /api/v1/users/invitations', () => {
  it('returns 401 without a session', async () => {
    await setSession(null);
    const res = await createInvitation(
      await buildRequest('http://localhost/api/v1/users/invitations', {
        method: 'POST',
        body: { email: 'x@example.com', role: 'viewer' },
      }),
    );
    expect(res.status).toBe(401);
  });

  it('returns 403 for an operator session (admin-only endpoint)', async () => {
    await setSession(sessionWithRole('operator'));
    const res = await createInvitation(
      await buildRequest('http://localhost/api/v1/users/invitations', {
        method: 'POST',
        body: { email: 'x@example.com', role: 'viewer' },
      }),
    );
    expect(res.status).toBe(403);
  });

  it('returns 403 for a viewer session', async () => {
    await setSession(sessionWithRole('viewer'));
    const res = await createInvitation(
      await buildRequest('http://localhost/api/v1/users/invitations', {
        method: 'POST',
        body: { email: 'x@example.com', role: 'viewer' },
      }),
    );
    expect(res.status).toBe(403);
  });

  it('creates an invitation and returns the public invite URL', async () => {
    const res = await createInvitation(
      await buildRequest('http://localhost/api/v1/users/invitations', {
        method: 'POST',
        body: { email: 'newbie@example.com', role: 'operator' },
      }),
    );
    expect(res.status).toBe(201);
    const body = await readJson<{
      data: {
        invitation: { id: string; email: string; role: string; expiresAt: string };
        inviteUrl: string;
      };
    }>(res);
    expect(body.data.invitation.email).toBe('newbie@example.com');
    expect(body.data.invitation.role).toBe('operator');
    expect(body.data.inviteUrl).toMatch(/^http:\/\/localhost\/invite\/[A-Za-z0-9_-]+$/);
  });

  it('400s on invalid email', async () => {
    const res = await createInvitation(
      await buildRequest('http://localhost/api/v1/users/invitations', {
        method: 'POST',
        body: { email: 'not-an-email', role: 'viewer' },
      }),
    );
    expect(res.status).toBe(400);
  });

  it('400s on unknown role', async () => {
    const res = await createInvitation(
      await buildRequest('http://localhost/api/v1/users/invitations', {
        method: 'POST',
        body: { email: 'x@example.com', role: 'superadmin' },
      }),
    );
    expect(res.status).toBe(400);
  });

  it('409s when an invitation already exists for that email', async () => {
    await createInvitation(
      await buildRequest('http://localhost/api/v1/users/invitations', {
        method: 'POST',
        body: { email: 'dup@example.com', role: 'viewer' },
      }),
    );
    const res = await createInvitation(
      await buildRequest('http://localhost/api/v1/users/invitations', {
        method: 'POST',
        body: { email: 'dup@example.com', role: 'operator' },
      }),
    );
    expect(res.status).toBe(409);
  });
});

describe('POST /api/v1/users/invitations/accept (public)', () => {
  async function createInvite(): Promise<string> {
    const res = await createInvitation(
      await buildRequest('http://localhost/api/v1/users/invitations', {
        method: 'POST',
        body: { email: 'accepter@example.com', role: 'operator' },
      }),
    );
    const body = await readJson<{ data: { inviteUrl: string } }>(res);
    const m = body.data.inviteUrl.match(/\/invite\/([^/]+)$/);
    if (!m) throw new Error('no token in inviteUrl');
    return m[1] as string;
  }

  it('accepts the token without authentication and creates the user', async () => {
    const token = await createInvite();
    await setSession(null); // public endpoint
    const res = await acceptInvitation(
      await buildRequest('http://localhost/api/v1/users/invitations/accept', {
        method: 'POST',
        body: { token, name: 'Accepter', password: 'sup3rsecret' },
      }),
    );
    expect(res.status).toBe(201);
    const body = await readJson<{
      data: { id: string; email: string; role: string; status: string };
    }>(res);
    expect(body.data.email).toBe('accepter@example.com');
    expect(body.data.role).toBe('operator');
    expect(body.data.status).toBe('active');
  });

  it('404s on an unknown token', async () => {
    await setSession(null);
    const res = await acceptInvitation(
      await buildRequest('http://localhost/api/v1/users/invitations/accept', {
        method: 'POST',
        body: { token: 'not-a-real-token-zzzzzz', name: 'X', password: 'pw-1234567' },
      }),
    );
    expect(res.status).toBe(404);
  });

  it('400s on a too-short password', async () => {
    const token = await createInvite();
    await setSession(null);
    const res = await acceptInvitation(
      await buildRequest('http://localhost/api/v1/users/invitations/accept', {
        method: 'POST',
        body: { token, name: 'X', password: 'short' },
      }),
    );
    expect(res.status).toBe(400);
  });

  it('cannot reuse a token after acceptance (single-use)', async () => {
    const token = await createInvite();
    await setSession(null);
    await acceptInvitation(
      await buildRequest('http://localhost/api/v1/users/invitations/accept', {
        method: 'POST',
        body: { token, name: 'OneShot', password: 'sup3rsecret' },
      }),
    );
    const res = await acceptInvitation(
      await buildRequest('http://localhost/api/v1/users/invitations/accept', {
        method: 'POST',
        body: { token, name: 'TwoShot', password: 'sup3rsecret' },
      }),
    );
    expect(res.status).toBe(404);
  });
});

describe('GET /api/v1/users', () => {
  it('returns 401 without a session', async () => {
    await setSession(null);
    const res = await listUsers(await buildRequest('http://localhost/api/v1/users'));
    expect(res.status).toBe(401);
  });

  it('returns 403 for an operator (operators have no users.read)', async () => {
    await setSession(sessionWithRole('operator'));
    const res = await listUsers(await buildRequest('http://localhost/api/v1/users'));
    expect(res.status).toBe(403);
  });

  it('returns 403 for a viewer', async () => {
    await setSession(sessionWithRole('viewer'));
    const res = await listUsers(await buildRequest('http://localhost/api/v1/users'));
    expect(res.status).toBe(403);
  });

  it('admin gets paginated list with meta', async () => {
    const res = await listUsers(await buildRequest('http://localhost/api/v1/users'));
    expect(res.status).toBe(200);
    const body = await readJson<{
      data: unknown[];
      meta: { page: number; limit: number; total: number; totalPages: number };
    }>(res);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.meta.page).toBe(1);
    expect(body.meta.limit).toBeGreaterThan(0);
  });
});

describe('PATCH /api/v1/users/:id', () => {
  async function inviteAndAccept(
    email: string,
    role: 'admin' | 'operator' | 'viewer',
  ): Promise<string> {
    const inviteRes = await createInvitation(
      await buildRequest('http://localhost/api/v1/users/invitations', {
        method: 'POST',
        body: { email, role },
      }),
    );
    const ib = await readJson<{ data: { inviteUrl: string } }>(inviteRes);
    const token = ib.data.inviteUrl.match(/\/invite\/([^/]+)$/)?.[1];
    if (!token) throw new Error('no token');
    await setSession(null);
    const acceptRes = await acceptInvitation(
      await buildRequest('http://localhost/api/v1/users/invitations/accept', {
        method: 'POST',
        body: { token, name: email, password: 'sup3rsecret' },
      }),
    );
    const ab = await readJson<{ data: { id: string } }>(acceptRes);
    await setSession(sessionWithRole('admin'));
    return ab.data.id;
  }

  it('returns 403 for an operator', async () => {
    const targetId = await inviteAndAccept('target@example.com', 'viewer');
    await setSession(sessionWithRole('operator'));
    const res = await patchUser(
      await buildRequest(`http://localhost/api/v1/users/${targetId}`, {
        method: 'PATCH',
        body: { role: 'admin' },
      }),
      routeContext({ id: targetId }),
    );
    expect(res.status).toBe(403);
  });

  it('admin can change a user role', async () => {
    const targetId = await inviteAndAccept('promote@example.com', 'viewer');
    const res = await patchUser(
      await buildRequest(`http://localhost/api/v1/users/${targetId}`, {
        method: 'PATCH',
        body: { role: 'operator' },
      }),
      routeContext({ id: targetId }),
    );
    expect(res.status).toBe(200);
    const body = await readJson<{ data: { id: string; role: string } }>(res);
    expect(body.data.role).toBe('operator');
  });

  it('admin can suspend and reactivate', async () => {
    const targetId = await inviteAndAccept('togglee@example.com', 'viewer');
    const suspended = await patchUser(
      await buildRequest(`http://localhost/api/v1/users/${targetId}`, {
        method: 'PATCH',
        body: { status: 'suspended' },
      }),
      routeContext({ id: targetId }),
    );
    expect(suspended.status).toBe(200);
    expect((await readJson<{ data: { status: string } }>(suspended)).data.status).toBe('suspended');

    const reactivated = await patchUser(
      await buildRequest(`http://localhost/api/v1/users/${targetId}`, {
        method: 'PATCH',
        body: { status: 'active' },
      }),
      routeContext({ id: targetId }),
    );
    expect(reactivated.status).toBe(200);
    expect((await readJson<{ data: { status: string } }>(reactivated)).data.status).toBe('active');
  });

  it('refuses to let an admin change their own role (self-lockout guard)', async () => {
    const res = await patchUser(
      await buildRequest(`http://localhost/api/v1/users/${FAKE_SESSION.user.id}`, {
        method: 'PATCH',
        body: { role: 'viewer' },
      }),
      routeContext({ id: FAKE_SESSION.user.id }),
    );
    expect(res.status).toBe(403);
  });

  it('refuses to let an admin suspend themselves', async () => {
    const res = await patchUser(
      await buildRequest(`http://localhost/api/v1/users/${FAKE_SESSION.user.id}`, {
        method: 'PATCH',
        body: { status: 'suspended' },
      }),
      routeContext({ id: FAKE_SESSION.user.id }),
    );
    expect(res.status).toBe(403);
  });

  it('400s on invalid uuid', async () => {
    const res = await patchUser(
      await buildRequest('http://localhost/api/v1/users/not-a-uuid', {
        method: 'PATCH',
        body: { role: 'viewer' },
      }),
      routeContext({ id: 'not-a-uuid' }),
    );
    expect(res.status).toBe(400);
  });

  it('400s on a body with no mutable fields', async () => {
    const targetId = await inviteAndAccept('empty-body@example.com', 'viewer');
    const res = await patchUser(
      await buildRequest(`http://localhost/api/v1/users/${targetId}`, {
        method: 'PATCH',
        body: {},
      }),
      routeContext({ id: targetId }),
    );
    expect(res.status).toBe(400);
  });

  it('404s on unknown id', async () => {
    const res = await patchUser(
      await buildRequest('http://localhost/api/v1/users/00000000-0000-4000-8000-000000000000', {
        method: 'PATCH',
        body: { role: 'viewer' },
      }),
      routeContext({ id: '00000000-0000-4000-8000-000000000000' }),
    );
    expect(res.status).toBe(404);
  });
});

describe('GET /api/v1/users/:id', () => {
  it('returns 403 for an operator', async () => {
    await setSession(sessionWithRole('operator'));
    const res = await getUser(
      await buildRequest('http://localhost/api/v1/users/00000000-0000-4000-8000-000000000000'),
      routeContext({ id: '00000000-0000-4000-8000-000000000000' }),
    );
    expect(res.status).toBe(403);
  });

  it('admin gets 404 for unknown id', async () => {
    const res = await getUser(
      await buildRequest('http://localhost/api/v1/users/00000000-0000-4000-8000-000000000000'),
      routeContext({ id: '00000000-0000-4000-8000-000000000000' }),
    );
    expect(res.status).toBe(404);
  });
});
