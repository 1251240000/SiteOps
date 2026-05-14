/**
 * Module augmentation for Auth.js v5.
 *
 * We attach `id` (the user's DB UUID) to both the session.user object and
 * the JWT, so API routes and React components can read it without an extra
 * DB round-trip.
 */
import { type DefaultSession } from 'next-auth';

declare module 'next-auth' {
  interface User {
    id: string;
    email?: string | null;
    name?: string | null;
  }
  interface Session {
    user: {
      id: string;
      email: string;
      name: string | null;
    } & DefaultSession['user'];
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    sub?: string;
    email?: string | null;
    name?: string | null;
  }
}
