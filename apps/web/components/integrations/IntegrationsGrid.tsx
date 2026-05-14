'use client';

import { useQuery } from '@tanstack/react-query';
import { Cloud, Github, BarChart3, Activity, Search, DollarSign } from 'lucide-react';

import { Skeleton } from '@/components/ui/skeleton';
import { api, type ApiError, type ApiSuccess } from '@/lib/api-client';

import { IntegrationCard, type ProviderStatus } from './IntegrationCard';

type StatusEnvelope = {
  cloudflare: ProviderStatus;
  github: ProviderStatus;
  ga4: ProviderStatus;
  plausible: ProviderStatus;
  gsc: ProviderStatus;
  adsense: ProviderStatus;
};

export function IntegrationsGrid() {
  const { data, isLoading, error } = useQuery<ApiSuccess<StatusEnvelope>, ApiError>({
    queryKey: ['integrations', 'status'],
    queryFn: () => api.get<StatusEnvelope>('/integrations/status'),
    refetchInterval: 30_000,
  });

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-48 w-full" />
        ))}
      </div>
    );
  }
  if (error || !data) {
    return (
      <p className="text-sm text-destructive">
        Failed to load integration status: {error?.message ?? 'unknown error'}
      </p>
    );
  }
  const s = data.data;

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
      <IntegrationCard
        icon={Cloud}
        name="Cloudflare Pages"
        description="Pull build/deploy history from CF Pages projects. Set CF_API_TOKEN in env."
        status={s.cloudflare}
        envReady={s.cloudflare.hasToken}
        endpoints={{
          test: '/integrations/cloudflare/test',
          sync: '/integrations/cloudflare/sync',
        }}
      />
      <IntegrationCard
        icon={Github}
        name="GitHub Actions"
        description="Sync workflow runs as deployment events. Set GH_TOKEN in env."
        status={s.github}
        envReady={s.github.hasToken}
        endpoints={{
          test: '/integrations/github/test',
          sync: '/integrations/github/sync',
        }}
      />
      <IntegrationCard
        icon={BarChart3}
        name="Google Analytics 4"
        description="Pull daily PV/UV/sessions via the Data API. Service account JSON in GA4_SERVICE_ACCOUNT_JSON."
        status={s.ga4}
        envReady={s.ga4.hasToken}
        endpoints={{
          sync: '/integrations/ga4/sync',
        }}
      />
      <IntegrationCard
        icon={Activity}
        name="Plausible"
        description="Optional analytics provider. Set PLAUSIBLE_API_KEY for any site with analyticsProvider=plausible."
        status={s.plausible}
        envReady={s.plausible.hasToken}
        endpoints={{
          sync: '/integrations/ga4/sync',
        }}
      />
      <IntegrationCard
        icon={Search}
        name="Search Console"
        description="Pull impressions/clicks/CTR. Requires GSC_OAUTH_* env then a one-time consent."
        status={s.gsc}
        envReady={s.gsc.hasOAuthClient}
        endpoints={{
          authUrl: '/integrations/gsc/auth-url',
          sync: '/integrations/gsc/sync',
        }}
      />
      <IntegrationCard
        icon={DollarSign}
        name="AdSense"
        description="Daily earnings & RPM via the AdSense Management API. Needs OAuth + ADSENSE_ACCOUNT_NAME."
        status={s.adsense}
        envReady={s.adsense.hasOAuthClient && s.adsense.hasAccountName}
        endpoints={{
          authUrl: '/integrations/adsense/auth-url',
          sync: '/integrations/adsense/sync',
        }}
      />
    </div>
  );
}
