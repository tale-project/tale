import { createFileRoute } from '@tanstack/react-router';

import { AutomationDetail } from '@/app/features/automations/components/automation-detail';
import { paramToAutomationSlug } from '@/app/features/automations/lib/slug';
import { asProjectId } from '@/app/features/projects/hooks/use-project-id-param';

export const Route = createFileRoute(
  '/dashboard/$id/projects/$projectId/automations/$automationSlug/',
)({
  component: ProjectAutomationDetailPage,
});

function ProjectAutomationDetailPage() {
  const { id: organizationId, projectId, automationSlug } = Route.useParams();
  return (
    <AutomationDetail
      organizationId={organizationId}
      automationSlug={paramToAutomationSlug(automationSlug)}
      projectId={asProjectId(projectId)}
    />
  );
}
