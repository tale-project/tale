import { createFileRoute } from '@tanstack/react-router';

import { AutomationVersionsTab } from '@/app/features/automations/components/automation-versions-tab';
import { paramToAutomationSlug } from '@/lib/automations/slug';

export const Route = createFileRoute(
  '/dashboard/$id/automations/$automationSlug/versions',
)({
  component: AutomationVersionsPage,
});

function AutomationVersionsPage() {
  const { id: organizationId, automationSlug } = Route.useParams();
  return (
    <AutomationVersionsTab
      organizationId={organizationId}
      automationSlug={paramToAutomationSlug(automationSlug)}
    />
  );
}
