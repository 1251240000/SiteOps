'use client';

import { signIn } from 'next-auth/react';
import { useState, type FormEvent } from 'react';

import { Button } from '@/components/ui/button';

type LoginFormProps = {
  callbackUrl: string;
  initialError?: string | undefined;
};

const inputClass =
  'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50';

export function LoginForm({ callbackUrl, initialError }: LoginFormProps) {
  const [error, setError] = useState<string | null>(
    initialError ? translateAuthError(initialError) : null,
  );
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const form = new FormData(e.currentTarget);
    const email = String(form.get('email') ?? '');
    const password = String(form.get('password') ?? '');
    try {
      const res = await signIn('credentials', {
        email,
        password,
        redirect: false,
        callbackUrl,
      });
      if (!res || res.error) {
        setError('Invalid email or password.');
        setSubmitting(false);
        return;
      }
      window.location.assign(res.url ?? callbackUrl);
    } catch {
      setError('Something went wrong. Please try again.');
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="space-y-4 rounded-lg border border-border bg-card p-6 text-card-foreground shadow-sm"
      aria-label="Sign in"
    >
      <div className="space-y-1">
        <h1 className="text-lg font-semibold tracking-tight">Sign in to siteops</h1>
        <p className="text-sm text-muted-foreground">
          Single-admin login. See <code className="text-xs">.env.example</code> for the seed user.
        </p>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="email" className="text-sm font-medium text-foreground">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="username"
          autoFocus
          className={inputClass}
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="password" className="text-sm font-medium text-foreground">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          autoComplete="current-password"
          className={inputClass}
        />
      </div>

      {error ? (
        <div
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {error}
        </div>
      ) : null}

      <Button type="submit" disabled={submitting} className="w-full">
        {submitting ? 'Signing in…' : 'Sign in'}
      </Button>
    </form>
  );
}

function translateAuthError(code: string): string {
  if (code === 'CredentialsSignin') return 'Invalid email or password.';
  return 'Unable to sign in. Please try again.';
}
