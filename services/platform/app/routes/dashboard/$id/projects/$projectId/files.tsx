import { createFileRoute } from '@tanstack/react-router';

import { ProjectFilesTab } from '@/app/features/projects/components/project-files-tab';
import { asProjectId } from '@/app/features/projects/hooks/use-project-id-param';

export const Route = createFileRoute(
  '/dashboard/$id/projects/$projectId/files',
)({
  component: ProjectFilesPage,
});

function ProjectFilesPage() {
  const { projectId } = Route.useParams();
  return <ProjectFilesTab projectId={asProjectId(projectId)} />;
}
