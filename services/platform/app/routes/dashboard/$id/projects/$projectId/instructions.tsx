import { createFileRoute } from '@tanstack/react-router';

import { asProjectId } from '@/app/features/projects/hooks/use-project-id-param';
import { lazyComponent } from '@/lib/utils/lazy-component';

const ProjectInstructionsEditor = lazyComponent(() =>
  import('@/app/features/projects/components/project-instructions-editor').then(
    (mod) => ({ default: mod.ProjectInstructionsEditor }),
  ),
);

export const Route = createFileRoute(
  '/dashboard/$id/projects/$projectId/instructions',
)({
  component: ProjectInstructionsPage,
});

function ProjectInstructionsPage() {
  const { projectId } = Route.useParams();
  return <ProjectInstructionsEditor projectId={asProjectId(projectId)} />;
}
