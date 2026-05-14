import { PageHeader } from '@/components/common/page-header';
import { DeploymentFilters } from '@/components/deployments/deployment-filters';
import { DeploymentList } from '@/components/deployments/deployment-list';

export const dynamic = 'force-dynamic';

export default function DeploymentsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Deployments"
        description="Cross-site deployment events. POST to /api/v1/deployments from CI/Agents (idempotent by provider + provider_deployment_id)."
      />
      <DeploymentFilters />
      <DeploymentList />
    </div>
  );
}
