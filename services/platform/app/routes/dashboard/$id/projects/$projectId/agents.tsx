import { createFileRoute } from '@tanstack/react-router';

import { asProjectId } from '@/app/features/projects/hooks/use-project-id-param';
import { lazyComponent } from '@/lib/utils/lazy-component';

const ProjectAgentsTab = lazyComponent(() =>
  import('@/app/features/projects/components/project-agents-tab').then(
    (mod) => ({ default: mod.ProjectAgentsTab }),
  ),
);

export const Route = createFileRoute(
  '/dashboard/$id/projects/$projectId/agents',
)({
  component: ProjectAgentsPage,
});

function ProjectAgentsPage() {
  const { id: organizationId, projectId } = Route.useParams();
  return (
    <ProjectAgentsTab
      organizationId={organizationId}
      projectId={asProjectId(projectId)}
    />
  );
}
