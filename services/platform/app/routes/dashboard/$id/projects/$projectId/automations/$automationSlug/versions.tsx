import { createFileRoute } from '@tanstack/react-router';

import { AutomationVersionsTab } from '@/app/features/automations/components/automation-versions-tab';
import { asProjectId } from '@/app/features/projects/hooks/use-project-id-param';
import { paramToAutomationSlug } from '@/lib/automations/slug';

export const Route = createFileRoute(
  '/dashboard/$id/projects/$projectId/automations/$automationSlug/versions',
)({
  component: ProjectAutomationVersionsPage,
});

function ProjectAutomationVersionsPage() {
  const { id: organizationId, projectId, automationSlug } = Route.useParams();
  return (
    <AutomationVersionsTab
      organizationId={organizationId}
      automationSlug={paramToAutomationSlug(automationSlug)}
      projectId={asProjectId(projectId)}
    />
  );
}
