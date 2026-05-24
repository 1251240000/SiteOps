/**
 * Shared helpers for API route-handler tests.
 *
 * The pattern is:
 *   1. `setupTestDb()` once per file (cached PGlite instance via
 *      `@siteops/db/testing`), then `resetDb()` per test.
 *   2. `mockAuth({ session })` to control the `auth()` return for the
 *      `withAuth` wrapper. Tests that want anonymous traffic pass `null`.
 *   3. `mockDb()` swaps `@/lib/db`'s `getDb()` for the PGlite handle.
 *
 * Both mocks must be installed at module top-level via `vi.mock()` (Vitest
 * hoists them above imports). The helpers below only set the *implementation*
 * — the file-level `vi.mock(...)` calls live in each test file so Vitest can
 * see them statically.
 */
import { vi } from 'vitest';
import type { NextRequest } from 'next/server';

import { createTestDb, type TestDbHandle } from '@siteops/db/testing';

let cached: TestDbHandle | undefined;

/** Boot (or reuse) a PGlite handle with all migrations applied. */
export async function setupTestDb(): Promise<TestDbHandle> {
  if (!cached) cached = await createTestDb();
  return cached;
}

/** Truncate every user table; safe to call between tests. */
export async function resetDb(): Promise<void> {
  if (!cached) return;
  await cached.reset();
}

/** Build a `NextRequest` for a given handler invocation. */
export async function buildRequest(
  url: string,
  init: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
): Promise<NextRequest> {
  const { NextRequest } = await import('next/server');
  const headers = new Headers(init.headers ?? {});
  if (init.body !== undefined && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }
  return new NextRequest(url, {
    method: init.method ?? 'GET',
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

/** Re-shape for the route param contract used by `[id]/route.ts` files. */
export function routeContext<T extends Record<string, string>>(params: T): { params: Promise<T> } {
  return { params: Promise.resolve(params) };
}

/** Shape of the fake auth session shared across every API route test. */
export type FakeSession = {
  user: { id: string; email: string; name: string; role: 'admin' | 'operator' | 'viewer' };
  expires: string;
};

/** Default authed session — admin user with `*` scope (ignored for session auth). */
export const FAKE_SESSION: FakeSession = {
  user: {
    id: '11111111-1111-4111-8111-111111111111',
    email: 'admin@test.local',
    name: 'Admin',
    role: 'admin',
  },
  expires: new Date(Date.now() + 86_400_000).toISOString(),
};

/**
 * Build a session for a non-admin role so tests can drive the RBAC gate in
 * `withApi` / `withAuth` without faking a whole NextAuth callback chain.
 *
 * The returned object is a structural superset of `FAKE_SESSION` and is safe
 * to feed directly into {@link setSession}.
 */
export function sessionForRole(role: FakeSession['user']['role']): FakeSession {
  return {
    ...FAKE_SESSION,
    user: { ...FAKE_SESSION.user, role },
  };
}

/**
 * Apply the `@/lib/auth` mock implementation. Tests that want to flip
 * between authed and anonymous can call this in their `beforeEach`.
 *
 * Pre-condition: the test file must already have:
 *   `vi.mock('@/lib/auth', () => ({ auth: vi.fn() }))`
 */
export async function setSession(session: FakeSession | null): Promise<void> {
  const mod = await import('@/lib/auth');
  vi.mocked(mod.auth as () => Promise<unknown>).mockResolvedValue(session);
}

/**
 * Apply the `@/lib/db` mock so handlers see the test PGlite handle.
 *
 * Pre-condition: the test file must already have:
 *   `vi.mock('@/lib/db', () => ({ getDb: vi.fn() }))`
 */
export async function bindDbMock(): Promise<void> {
  const handle = await setupTestDb();
  const mod = await import('@/lib/db');
  vi.mocked(mod.getDb as () => unknown).mockReturnValue(handle.db);
}

/** Read JSON body from a `Response` produced by a route handler. */
export async function readJson<T = unknown>(res: Response): Promise<T> {
  return (await res.json()) as T;
}
