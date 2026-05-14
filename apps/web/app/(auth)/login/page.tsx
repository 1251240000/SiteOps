import { redirect } from 'next/navigation';

import { auth } from '@/lib/auth';

import { LoginForm } from './login-form';

type LoginPageProps = {
  // Next.js 15: `searchParams` is async.
  searchParams: Promise<{ callbackUrl?: string; error?: string }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const session = await auth();
  const sp = await searchParams;
  if (session?.user) {
    redirect(safeCallbackUrl(sp.callbackUrl) ?? '/');
  }
  return <LoginForm callbackUrl={safeCallbackUrl(sp.callbackUrl) ?? '/'} initialError={sp.error} />;
}

/** Restrict callbackUrl to same-origin paths to avoid open redirects. */
function safeCallbackUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (value.startsWith('/') && !value.startsWith('//')) return value;
  return undefined;
}
