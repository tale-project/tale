import { createFileRoute, Outlet } from '@tanstack/react-router';

import { AutomationsAccessGate } from '@/app/features/automations/components/automations-access-gate';

/**
 * A project's automation pages — its Automations tab, one automation's tabs
 * and its runs — are for Owners, Admins and Developers, like the
 * organization's.
 */
export const Route = createFileRoute(
  '/dashboard/$id/projects/$projectId/automations',
)({
  component: ProjectAutomationsLayout,
});

function ProjectAutomationsLayout() {
  return (
    <AutomationsAccessGate>
      <Outlet />
    </AutomationsAccessGate>
  );
}
