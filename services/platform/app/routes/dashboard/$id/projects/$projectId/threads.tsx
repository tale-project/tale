import { createFileRoute } from '@tanstack/react-router';

import { ProjectThreadsTab } from '@/app/features/projects/components/project-threads-tab';
import { asProjectId } from '@/app/features/projects/hooks/use-project-id-param';

export const Route = createFileRoute(
  '/dashboard/$id/projects/$projectId/threads',
)({
  component: ProjectThreadsPage,
});

function ProjectThreadsPage() {
  const { id: organizationId, projectId } = Route.useParams();
  return (
    <ProjectThreadsTab
      organizationId={organizationId}
      projectId={asProjectId(projectId)}
    />
  );
}
