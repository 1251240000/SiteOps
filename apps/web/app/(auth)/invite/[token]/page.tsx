import { redirect } from 'next/navigation';

import { auth } from '@/lib/auth';

import { AcceptInvitationForm } from './accept-form';

type InvitePageProps = {
  params: Promise<{ token: string }>;
};

/**
 * Public invitation acceptance page.
 *
 * The token in the URL is opaque to us — it gets POSTed to
 * `/api/v1/users/invitations/accept` along with the chosen password and
 * display name. The server validates token freshness + creates the user.
 * If the visitor is already logged in, redirect to the dashboard so they
 * don't accidentally claim someone else's invite while authenticated.
 */
export default async function InvitePage({ params }: InvitePageProps) {
  const session = await auth();
  if (session?.user) redirect('/');

  const { token } = await params;
  return <AcceptInvitationForm token={token} />;
}
