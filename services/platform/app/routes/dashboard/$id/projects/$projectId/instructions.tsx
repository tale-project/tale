import { createFileRoute } from '@tanstack/react-router';

import { ProjectTabSkeleton } from '@/app/features/projects/components/project-tab-skeleton';
import { asProjectId } from '@/app/features/projects/hooks/use-project-id-param';
import { lazyComponent } from '@/lib/utils/lazy-component';

const ProjectInstructionsEditor = lazyComponent(
  () =>
    import('@/app/features/projects/components/project-instructions-editor').then(
      (mod) => ({ default: mod.ProjectInstructionsEditor }),
    ),
  // Show the layout-shaped skeleton while the tab's JS chunk loads.
  { loading: () => <ProjectTabSkeleton /> },
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
