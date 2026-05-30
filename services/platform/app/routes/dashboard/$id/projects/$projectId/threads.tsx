import { createFileRoute } from '@tanstack/react-router';

import { ProjectTabSkeleton } from '@/app/features/projects/components/project-tab-skeleton';
import { asProjectId } from '@/app/features/projects/hooks/use-project-id-param';
import { lazyComponent } from '@/lib/utils/lazy-component';

const ProjectThreadsTab = lazyComponent(
  () =>
    import('@/app/features/projects/components/project-threads-tab').then(
      (mod) => ({ default: mod.ProjectThreadsTab }),
    ),
  // Show the layout-shaped skeleton while the tab's JS chunk loads.
  { loading: () => <ProjectTabSkeleton /> },
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
