import { SkeletonText } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { StickySectionHeader } from '@tale/ui/sticky-section-header';
import { createFileRoute } from '@tanstack/react-router';

import { ContentArea } from '@/app/components/layout/content-area';
import { asProjectId } from '@/app/features/projects/hooks/use-project-id-param';
import { lazyComponent } from '@/lib/utils/lazy-component';

// Skeletonized layout frame shown while the tab's JS chunk loads — the real
// tab (with its own data-loading mask) takes over once the chunk resolves.
function ThreadsChunkFallback() {
  return (
    <ContentArea variant="narrow" gap={6}>
      <Skeletonize loading>
        <StickySectionHeader
          title={<SkeletonText lines={1} />}
          description={<SkeletonText lines={1} />}
        />
        <SkeletonText lines={3} />
      </Skeletonize>
    </ContentArea>
  );
}

const ProjectThreadsTab = lazyComponent(
  () =>
    import('@/app/features/projects/components/project-threads-tab').then(
      (mod) => ({ default: mod.ProjectThreadsTab }),
    ),
  { loading: () => <ThreadsChunkFallback /> },
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
