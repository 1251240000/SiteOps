'use client';

import { type LucideIcon, RefreshCw, Plug } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { api, type ApiError, type ApiSuccess } from '@/lib/api-client';

export type ProviderStatus = {
  configured: boolean;
  hasToken?: boolean;
  hasOAuthClient?: boolean;
  hasAccountName?: boolean;
  lastSyncedAt: string | null;
  lastError: string | null;
  perSite: Array<{ siteId: string | null; lastSyncedAt: string | null; lastError: string | null }>;
};

type Endpoints = {
  test?: string;
  sync?: string;
  authUrl?: string;
};

export interface IntegrationCardProps {
  icon: LucideIcon;
  name: string;
  description: string;
  status: ProviderStatus;
  endpoints: Endpoints;
  /** Extra config slot rendered below the header — e.g. property/account input. */
  configHint?: ReactNode;
  /** Extra body slot for per-provider notes. */
  body?: ReactNode;
  /** Override env-readiness label. */
  envReady?: boolean;
}

function fmtTs(iso: string | null): string {
  if (!iso) return 'never';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export function IntegrationCard({
  icon: Icon,
  name,
  description,
  status,
  endpoints,
  configHint,
  body,
  envReady,
}: IntegrationCardProps) {
  const ready =
    envReady ??
    (status.hasToken || status.hasOAuthClient || Boolean(status.hasAccountName) || false);
  const [busy, setBusy] = useState<'test' | 'sync' | 'oauth' | null>(null);

  async function runTest() {
    if (!endpoints.test) return;
    setBusy('test');
    try {
      await api.post(endpoints.test, {});
      toast.success(`${name}: connection OK`);
    } catch (err) {
      toast.error(`${name}: ${(err as ApiError).message}`);
    } finally {
      setBusy(null);
    }
  }

  async function runSync() {
    if (!endpoints.sync) return;
    setBusy('sync');
    try {
      const res = (await api.post(endpoints.sync, {})) as ApiSuccess<unknown>;
      void res;
      toast.success(`${name}: sync started`);
    } catch (err) {
      toast.error(`${name}: ${(err as ApiError).message}`);
    } finally {
      setBusy(null);
    }
  }

  async function startOAuth() {
    if (!endpoints.authUrl) return;
    setBusy('oauth');
    try {
      const res = (await api.get(endpoints.authUrl)) as ApiSuccess<{ url: string }>;
      window.location.href = res.data.url;
    } catch (err) {
      toast.error(`${name}: ${(err as ApiError).message}`);
      setBusy(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <span className="grid size-10 place-items-center rounded-md bg-muted text-foreground">
              <Icon className="size-5" aria-hidden />
            </span>
            <div className="space-y-1">
              <CardTitle className="text-base">{name}</CardTitle>
              <CardDescription>{description}</CardDescription>
            </div>
          </div>
          <Badge variant={ready ? 'success' : 'muted'}>
            {ready ? 'configured' : 'not configured'}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {configHint}
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
          <dt className="text-muted-foreground">last sync</dt>
          <dd className="text-foreground">{fmtTs(status.lastSyncedAt)}</dd>
          <dt className="text-muted-foreground">last error</dt>
          <dd className="text-foreground">
            {status.lastError ? (
              <span className="font-mono text-destructive">{status.lastError}</span>
            ) : (
              '—'
            )}
          </dd>
          <dt className="text-muted-foreground">sites tracked</dt>
          <dd className="text-foreground">{status.perSite.length}</dd>
        </dl>
        {body}
        <div className="flex flex-wrap gap-2 pt-2">
          {endpoints.test ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => void runTest()}
              disabled={busy !== null || !ready}
            >
              <Plug className="mr-1 size-3.5" />
              Test
            </Button>
          ) : null}
          {endpoints.authUrl ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => void startOAuth()}
              disabled={busy !== null || !ready}
            >
              Connect
            </Button>
          ) : null}
          {endpoints.sync ? (
            <Button size="sm" onClick={() => void runSync()} disabled={busy !== null || !ready}>
              <RefreshCw className={`mr-1 size-3.5 ${busy === 'sync' ? 'animate-spin' : ''}`} />
              Sync now
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
