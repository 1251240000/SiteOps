'use client';

import { useQuery } from '@tanstack/react-query';
import { Cloud, Github, BarChart3, Activity, Search, DollarSign } from 'lucide-react';
import { useTranslations } from 'next-intl';

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
  const t = useTranslations('pages.integrations');
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
        {t('loadFailed', { error: error?.message ?? t('unknownError') })}
      </p>
    );
  }
  const s = data.data;

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
      <IntegrationCard
        icon={Cloud}
        name={t('providers.cloudflare.name')}
        description={t('providers.cloudflare.description')}
        status={s.cloudflare}
        envReady={s.cloudflare.hasToken}
        endpoints={{
          test: '/integrations/cloudflare/test',
          sync: '/integrations/cloudflare/sync',
        }}
      />
      <IntegrationCard
        icon={Github}
        name={t('providers.github.name')}
        description={t('providers.github.description')}
        status={s.github}
        envReady={s.github.hasToken}
        endpoints={{
          test: '/integrations/github/test',
          sync: '/integrations/github/sync',
        }}
      />
      <IntegrationCard
        icon={BarChart3}
        name={t('providers.ga4.name')}
        description={t('providers.ga4.description')}
        status={s.ga4}
        envReady={s.ga4.hasToken}
        endpoints={{
          sync: '/integrations/ga4/sync',
        }}
      />
      <IntegrationCard
        icon={Activity}
        name={t('providers.plausible.name')}
        description={t('providers.plausible.description')}
        status={s.plausible}
        envReady={s.plausible.hasToken}
        endpoints={{
          sync: '/integrations/ga4/sync',
        }}
      />
      <IntegrationCard
        icon={Search}
        name={t('providers.gsc.name')}
        description={t('providers.gsc.description')}
        status={s.gsc}
        envReady={s.gsc.hasOAuthClient}
        endpoints={{
          authUrl: '/integrations/gsc/auth-url',
          sync: '/integrations/gsc/sync',
        }}
      />
      <IntegrationCard
        icon={DollarSign}
        name={t('providers.adsense.name')}
        description={t('providers.adsense.description')}
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
