import { PageHeader } from '@/components/common/page-header';
import { SiteForm } from '@/components/sites/site-form';

export const dynamic = 'force-dynamic';

export default function NewSitePage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="New site"
        description="Register a site so the dashboard can track domains, deployments, and audits."
      />
      <SiteForm mode="create" />
    </div>
  );
}
