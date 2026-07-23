import { createFileRoute } from '@tanstack/react-router';

import { AutomationDetail } from '@/app/features/automations/components/automation-detail';
import { paramToAutomationSlug } from '@/app/features/automations/lib/slug';

export const Route = createFileRoute(
  '/dashboard/$id/automations/$automationSlug/',
)({
  component: AutomationDetailPage,
});

function AutomationDetailPage() {
  const { id: organizationId, automationSlug } = Route.useParams();
  return (
    <AutomationDetail
      organizationId={organizationId}
      automationSlug={paramToAutomationSlug(automationSlug)}
    />
  );
}
