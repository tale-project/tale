import { createFileRoute } from '@tanstack/react-router';

import { ProjectInstructionsEditor } from '@/app/features/projects/components/project-instructions-editor';
import { asProjectId } from '@/app/features/projects/hooks/use-project-id-param';

export const Route = createFileRoute(
  '/dashboard/$id/projects/$projectId/instructions',
)({
  component: ProjectInstructionsPage,
});

function ProjectInstructionsPage() {
  const { projectId } = Route.useParams();
  return <ProjectInstructionsEditor projectId={asProjectId(projectId)} />;
}
