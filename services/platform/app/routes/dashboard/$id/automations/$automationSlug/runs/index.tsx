import { createFileRoute } from '@tanstack/react-router';

import { AutomationRunsTab } from '@/app/features/automations/components/automation-runs-tab';
import { paramToAutomationSlug } from '@/lib/automations/slug';
import { seo } from '@/lib/utils/seo';

export const Route = createFileRoute(
  '/dashboard/$id/automations/$automationSlug/runs/',
)({
  head: () => ({ meta: seo('automationRuns') }),
  component: AutomationRunsPage,
});

function AutomationRunsPage() {
  const { id: organizationId, automationSlug } = Route.useParams();
  return (
    <AutomationRunsTab
      organizationId={organizationId}
      automationSlug={paramToAutomationSlug(automationSlug)}
    />
  );
}
