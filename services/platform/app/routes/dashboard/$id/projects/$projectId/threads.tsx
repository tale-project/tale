import { createFileRoute } from '@tanstack/react-router';

import { asProjectId } from '@/app/features/projects/hooks/use-project-id-param';
import { lazyComponent } from '@/lib/utils/lazy-component';

const ProjectThreadsTab = lazyComponent(() =>
  import('@/app/features/projects/components/project-threads-tab').then(
    (mod) => ({ default: mod.ProjectThreadsTab }),
  ),
);

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
