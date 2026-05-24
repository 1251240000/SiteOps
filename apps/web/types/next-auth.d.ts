/**
 * Module augmentation for Auth.js v5.
 *
 * We attach `id` (the user's DB UUID) and `role` to both the session.user
 * object and the JWT, so API routes and React components can read them
 * without an extra DB round-trip.
 */
import { type DefaultSession } from 'next-auth';

import type { UserRole } from '@siteops/shared';

declare module 'next-auth' {
  interface User {
    id: string;
    email?: string | null;
    name?: string | null;
    role?: UserRole;
  }
  interface Session {
    user: {
      id: string;
      email: string;
      name: string | null;
      role: UserRole;
    } & DefaultSession['user'];
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    sub?: string;
    email?: string | null;
    name?: string | null;
    role?: UserRole;
  }
}
