import { PageHeader } from '@/components/common/page-header';
import { ErrorList } from '@/components/errors/ErrorList';

export const dynamic = 'force-dynamic';

export default function ErrorsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Errors"
        description="Aggregated error reports from JS / build / API / worker. POST to /api/v1/errors with an API key (scope: errors:write)."
      />
      <ErrorList />
    </div>
  );
}
