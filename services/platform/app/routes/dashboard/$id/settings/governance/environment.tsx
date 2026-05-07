import { createFileRoute } from '@tanstack/react-router';

import { RetentionEnvironmentPanel } from '@/app/features/settings/governance/components/retention-environment-panel';

export const Route = createFileRoute(
  '/dashboard/$id/settings/governance/environment',
)({
  component: EnvironmentRoute,
});

function EnvironmentRoute() {
  const { id: organizationId } = Route.useParams();
  return (
    <div className="flex flex-col">
      <RetentionEnvironmentPanel organizationId={organizationId} />
    </div>
  );
}
