'use client';

import { signIn } from 'next-auth/react';
import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';

import { Button } from '@/components/ui/button';
import { api, type ApiError, type ApiSuccess } from '@/lib/api-client';

type AcceptFormProps = { token: string };

const inputClass =
  'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50';

type AcceptedUser = {
  id: string;
  email: string;
  name: string | null;
};

export function AcceptInvitationForm({ token }: AcceptFormProps) {
  const t = useTranslations('auth.invite');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setError(null);

    const form = new FormData(e.currentTarget);
    const name = String(form.get('name') ?? '').trim();
    const password = String(form.get('password') ?? '');
    const confirm = String(form.get('confirm') ?? '');

    if (password.length < 8) {
      setError(t('errorPasswordShort'));
      return;
    }
    if (password !== confirm) {
      setError(t('errorPasswordMismatch'));
      return;
    }

    setSubmitting(true);
    try {
      const res = (await api.post<AcceptedUser>('/users/invitations/accept', {
        token,
        name,
        password,
      })) as ApiSuccess<AcceptedUser>;

      // Auto-log-in with the freshly created credentials so the user lands on
      // the dashboard without an extra hop. If sign-in fails for any reason,
      // we still bounce them to /login so they can try manually.
      const signInRes = await signIn('credentials', {
        email: res.data.email,
        password,
        redirect: false,
        callbackUrl: '/',
      });
      if (!signInRes || signInRes.error) {
        window.location.assign('/login');
        return;
      }
      window.location.assign(signInRes.url ?? '/');
    } catch (err) {
      const code = (err as ApiError | undefined)?.code;
      if (code === 'not_found') setError(t('errorInvalidToken'));
      else if (code === 'conflict') setError(t('errorEmailExists'));
      else setError((err as ApiError | undefined)?.message ?? t('errorGeneric'));
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
        <h1 className="text-lg font-semibold tracking-tight">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('description')}</p>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="name" className="text-sm font-medium text-foreground">
          {t('name')}
        </label>
        <input
          id="name"
          name="name"
          type="text"
          required
          autoComplete="name"
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
          minLength={8}
          autoComplete="new-password"
          className={inputClass}
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="confirm" className="text-sm font-medium text-foreground">
          {t('confirmPassword')}
        </label>
        <input
          id="confirm"
          name="confirm"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
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
        {submitting ? t('submitting') : t('submit')}
      </Button>
    </form>
  );
}
