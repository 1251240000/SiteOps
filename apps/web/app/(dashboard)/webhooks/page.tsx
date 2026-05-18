import { getTranslations } from 'next-intl/server';

import { PageHeader } from '@/components/common/page-header';
import { WebhooksTable } from '@/components/webhooks/WebhooksTable';

export const dynamic = 'force-dynamic';

/**
 * `/webhooks` — admin view of inbound webhook deliveries (T27).
 *
 * Shows signature-failed rows (audit trail), processed rows (success),
 * and pending/failed rows that admins can replay via the row's button.
 */
export default async function WebhooksPage() {
  const t = await getTranslations('pages.webhooks');

  return (
    <div className="space-y-6">
      <PageHeader title={t('title')} description={t('description')} />
      <WebhooksTable />
    </div>
  );
}
