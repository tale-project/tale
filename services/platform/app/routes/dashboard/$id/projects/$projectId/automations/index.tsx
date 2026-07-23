import { createFileRoute } from '@tanstack/react-router';

import { AutomationsList } from '@/app/features/automations/components/automations-list';
import { asProjectId } from '@/app/features/projects/hooks/use-project-id-param';

export const Route = createFileRoute(
  '/dashboard/$id/projects/$projectId/automations/',
)({
  component: ProjectAutomationsIndexPage,
});

function ProjectAutomationsIndexPage() {
  const { id: organizationId, projectId } = Route.useParams();
  return (
    <AutomationsList
      organizationId={organizationId}
      projectId={asProjectId(projectId)}
    />
  );
}
