import { createFileRoute } from '@tanstack/react-router';

import { AutomationGeneralTab } from '@/app/features/automations/components/automation-general-tab';
import { paramToAutomationSlug } from '@/lib/automations/slug';

export const Route = createFileRoute(
  '/dashboard/$id/automations/$automationSlug/general',
)({
  component: AutomationGeneralPage,
});

function AutomationGeneralPage() {
  const { id: organizationId, automationSlug } = Route.useParams();
  return (
    <AutomationGeneralTab
      organizationId={organizationId}
      automationSlug={paramToAutomationSlug(automationSlug)}
    />
  );
}
