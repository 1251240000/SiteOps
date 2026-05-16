'use client';

import { signIn } from 'next-auth/react';
import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';

import { Button } from '@/components/ui/button';

type LoginFormProps = {
  callbackUrl: string;
  initialError?: string | undefined;
};

type AuthErrorKey = 'errorInvalid' | 'errorGeneric';

const inputClass =
  'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50';

export function LoginForm({ callbackUrl, initialError }: LoginFormProps) {
  const t = useTranslations('auth');
  const [error, setError] = useState<AuthErrorKey | null>(
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
        setError('errorInvalid');
        setSubmitting(false);
        return;
      }
      window.location.assign(res.url ?? callbackUrl);
    } catch {
      setError('errorGeneric');
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="space-y-4 rounded-lg border border-border bg-card p-6 text-card-foreground shadow-sm"
      aria-label={t('formAriaLabel')}
    >
      <div className="space-y-1">
        <h1 className="text-lg font-semibold tracking-tight">{t('signInTitle')}</h1>
        <p className="text-sm text-muted-foreground">
          {t.rich('signInDescription', {
            code: (chunks) => <code className="text-xs">{chunks}</code>,
          })}
        </p>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="email" className="text-sm font-medium text-foreground">
          {t('email')}
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
          {t('password')}
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
          {t(error)}
        </div>
      ) : null}

      <Button type="submit" disabled={submitting} className="w-full">
        {submitting ? t('submitting') : t('submit')}
      </Button>
    </form>
  );
}

function translateAuthError(code: string): AuthErrorKey {
  if (code === 'CredentialsSignin') return 'errorInvalid';
  return 'errorGeneric';
}
