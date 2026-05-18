import { getTranslations } from 'next-intl/server';

import { ApiKeysTable } from '@/components/api-keys/ApiKeysTable';
import { CreateApiKeyDialog } from '@/components/api-keys/CreateApiKeyDialog';
import { PageHeader } from '@/components/common/page-header';

export const dynamic = 'force-dynamic';

/**
 * `/settings/api-keys` — admin self-service for issuing & revoking
 * Bearer-token API keys used by external Agents / CI.
 */
export default async function ApiKeysPage() {
  const t = await getTranslations('pages.apiKeys');

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={<CreateApiKeyDialog />}
      />
      <ApiKeysTable />
    </div>
  );
}
