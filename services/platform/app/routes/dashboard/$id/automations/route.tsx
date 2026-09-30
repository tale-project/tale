import { createFileRoute, Outlet } from '@tanstack/react-router';

import { AutomationsAccessGate } from '@/app/features/automations/components/automations-access-gate';

/**
 * Every organization automation page — the list, its metrics, one
 * automation's tabs and its runs — is for Owners, Admins and Developers.
 */
export const Route = createFileRoute('/dashboard/$id/automations')({
  component: AutomationsLayout,
});

function AutomationsLayout() {
  return (
    <AutomationsAccessGate>
      <Outlet />
    </AutomationsAccessGate>
  );
}
