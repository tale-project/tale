import { createFileRoute } from '@tanstack/react-router';

import { SettingsPage } from '@/app/features/settings/components/settings-page';
import { TrashPage } from '@/app/features/settings/governance/components/trash-page';

export const Route = createFileRoute(
  '/dashboard/$id/settings/governance/trash',
)({
  component: TrashRoute,
});

function TrashRoute() {
  const { id: organizationId } = Route.useParams();
  return (
    <SettingsPage>
      <TrashPage organizationId={organizationId} />
    </SettingsPage>
  );
}
