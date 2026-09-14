import { createFileRoute } from '@tanstack/react-router';

import { ProjectThreadsSkeleton } from '@/app/features/projects/components/project-tab-skeletons';
import { asProjectId } from '@/app/features/projects/hooks/use-project-id-param';
import { lazyComponent } from '@/lib/utils/lazy-component';

// Skeletonized layout frame shown while the tab's JS chunk loads — the real
// tab (with its own data-loading mask) takes over once the chunk resolves.

const ProjectThreadsTab = lazyComponent(
  () =>
    import('@/app/features/projects/components/project-threads-tab').then(
      (mod) => ({ default: mod.ProjectThreadsTab }),
    ),
  { loading: () => <ProjectThreadsSkeleton /> },
);

export const Route = createFileRoute(
  '/dashboard/$id/projects/$projectId/threads',
)({
  // Warm the tab chunk during the loader so it's cached by render time —
  // removes the Suspense fallback flash on first nav (tab links preload on
  // render, so this typically fires before the click). Fire-and-forget.
  loader: () => {
    void import('@/app/features/projects/components/project-threads-tab');
  },
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
