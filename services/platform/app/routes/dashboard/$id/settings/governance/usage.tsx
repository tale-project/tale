import { createFileRoute } from '@tanstack/react-router';

import { UsageMetricsPage } from '@/app/features/analytics/usage/usage-metrics-page';

export const Route = createFileRoute(
  '/dashboard/$id/settings/governance/usage',
)({
  component: UsageRoute,
});

function UsageRoute() {
  const { id: organizationId } = Route.useParams();
  return (
    <div className="pb-8">
      <UsageMetricsPage organizationId={organizationId} />
    </div>
  );
}
