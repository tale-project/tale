import { createFileRoute } from '@tanstack/react-router';

import { ProjectAgentsTab } from '@/app/features/projects/components/project-agents-tab';
import { asProjectId } from '@/app/features/projects/hooks/use-project-id-param';

export const Route = createFileRoute(
  '/dashboard/$id/projects/$projectId/agents',
)({
  component: ProjectAgentsPage,
});

function ProjectAgentsPage() {
  const { projectId } = Route.useParams();
  return <ProjectAgentsTab projectId={asProjectId(projectId)} />;
}
