import { createFileRoute } from '@tanstack/react-router';

import { AutomationRunsTab } from '@/app/features/automations/components/automation-runs-tab';
import { asProjectId } from '@/app/features/projects/hooks/use-project-id-param';
import { paramToAutomationSlug } from '@/lib/automations/slug';
import { seo } from '@/lib/utils/seo';

export const Route = createFileRoute(
  '/dashboard/$id/projects/$projectId/automations/$automationSlug/runs/',
)({
  head: () => ({ meta: seo('automationRuns') }),
  component: ProjectAutomationRunsPage,
});

function ProjectAutomationRunsPage() {
  const { id: organizationId, projectId, automationSlug } = Route.useParams();
  return (
    <AutomationRunsTab
      organizationId={organizationId}
      automationSlug={paramToAutomationSlug(automationSlug)}
      projectId={asProjectId(projectId)}
    />
  );
}
