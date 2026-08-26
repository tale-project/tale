import { createFileRoute } from '@tanstack/react-router';

import { ProjectOverview } from '@/app/features/projects/components/project-overview';
import { asProjectId } from '@/app/features/projects/hooks/use-project-id-param';

export const Route = createFileRoute(
  '/dashboard/$id/projects/$projectId/overview',
)({
  component: ProjectOverviewPage,
});

function ProjectOverviewPage() {
  const { id: organizationId, projectId } = Route.useParams();
  return (
    <ProjectOverview
      organizationId={organizationId}
      projectId={asProjectId(projectId)}
    />
  );
}
