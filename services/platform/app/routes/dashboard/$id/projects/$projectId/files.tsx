import { createFileRoute } from '@tanstack/react-router';

import { ProjectTabSkeleton } from '@/app/features/projects/components/project-tab-skeleton';
import { asProjectId } from '@/app/features/projects/hooks/use-project-id-param';
import { lazyComponent } from '@/lib/utils/lazy-component';

// §8: lazy-load tab content. Overview stays eager (default landing); the
// other tabs are bundled on first navigation only.
const ProjectFilesTab = lazyComponent(
  () =>
    import('@/app/features/projects/components/project-files-tab').then(
      (mod) => ({ default: mod.ProjectFilesTab }),
    ),
  // Show the layout-shaped skeleton while the tab's JS chunk loads.
  { loading: () => <ProjectTabSkeleton /> },
);

export const Route = createFileRoute(
  '/dashboard/$id/projects/$projectId/files',
)({
  component: ProjectFilesPage,
});

function ProjectFilesPage() {
  const { id: organizationId, projectId } = Route.useParams();
  return (
    <ProjectFilesTab
      organizationId={organizationId}
      projectId={asProjectId(projectId)}
    />
  );
}
