/**
 * Thin re-export so `app/api/auth/[...nextauth]/route.ts` doesn't need to
 * `'use server'` an import path with type augmentation side-effects.
 */
import { handlers } from './auth';

export const GET = handlers.GET;
export const POST = handlers.POST;
