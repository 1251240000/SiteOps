import { PageHeader } from '@/components/common/page-header';
import { IntegrationsGrid } from '@/components/integrations/IntegrationsGrid';

export const dynamic = 'force-dynamic';

export default function IntegrationsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Integrations"
        description="Pull data from Cloudflare, GitHub, GA4 / Plausible, Search Console, and AdSense. All scheduled hourly/daily; click Sync to force a run."
      />
      <IntegrationsGrid />
    </div>
  );
}
