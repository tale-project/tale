import { lazyComponent } from '@tale/ui/lazy-component';
import { createFileRoute } from '@tanstack/react-router';

import { ProjectDispatchSkeleton } from '@/app/features/projects/components/project-tab-skeletons';
import { asProjectId } from '@/app/features/projects/hooks/use-project-id-param';

// Skeletonized layout frame shown while the tab's JS chunk loads, so the
// content frame doesn't go blank between navigation and chunk-ready. The real
// tab (with its own data-loading mask) takes over once the chunk resolves.

const ProjectDispatchTab = lazyComponent(
  () =>
    import('@/app/features/projects/components/project-dispatch-tab').then(
      (mod) => ({ default: mod.ProjectDispatchTab }),
    ),
  { loading: () => <ProjectDispatchSkeleton /> },
);

export const Route = createFileRoute(
  '/dashboard/$id/projects/$projectId/dispatch',
)({
  // Warm the tab chunk during the loader so it's cached by render time —
  // removes the Suspense fallback flash on first nav (tab links preload on
  // render, so this typically fires before the click). Fire-and-forget.
  loader: () => {
    void import('@/app/features/projects/components/project-dispatch-tab');
  },
  component: ProjectDispatchPage,
});

function ProjectDispatchPage() {
  const { id: organizationId, projectId } = Route.useParams();
  return (
    <ProjectDispatchTab
      key={`${organizationId}:${projectId}`}
      organizationId={organizationId}
      projectId={asProjectId(projectId)}
    />
  );
}
