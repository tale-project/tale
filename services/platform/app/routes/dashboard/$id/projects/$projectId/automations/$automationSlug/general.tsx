import { createFileRoute } from '@tanstack/react-router';

import { AutomationGeneralTab } from '@/app/features/automations/components/automation-general-tab';
import { paramToAutomationSlug } from '@/lib/automations/slug';

export const Route = createFileRoute(
  '/dashboard/$id/projects/$projectId/automations/$automationSlug/general',
)({
  component: ProjectAutomationGeneralPage,
});

function ProjectAutomationGeneralPage() {
  const { id: organizationId, automationSlug } = Route.useParams();
  // The settings belong to the automation, not to the project it is shown
  // in: the same Trigger and Projects as on the organization's route.
  return (
    <AutomationGeneralTab
      organizationId={organizationId}
      automationSlug={paramToAutomationSlug(automationSlug)}
    />
  );
}
