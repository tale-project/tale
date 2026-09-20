import { createFileRoute } from '@tanstack/react-router';

import { TrashPage } from '@/app/features/settings/governance/components/trash-page';

export const Route = createFileRoute(
  '/dashboard/$id/settings/governance/trash',
)({
  component: TrashRoute,
});

function TrashRoute() {
  const { id: organizationId } = Route.useParams();
  // The page owns its own `SettingsPage` frame — its bounded-height,
  // full-width shell is what lets the trash table scroll inside a fixed
  // frame, the same way the Logs page does.
  return <TrashPage organizationId={organizationId} />;
}
