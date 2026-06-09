import { SkeletonText } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { StickySectionHeader } from '@tale/ui/sticky-section-header';
import { createFileRoute } from '@tanstack/react-router';

import { ContentArea } from '@/app/components/layout/content-area';
import { asProjectId } from '@/app/features/projects/hooks/use-project-id-param';
import { lazyComponent } from '@/lib/utils/lazy-component';

// Skeletonized layout frame shown while the tab's JS chunk loads, so the
// content frame doesn't go blank between navigation and chunk-ready. The real
// tab (with its own data-loading mask) takes over once the chunk resolves.
function AgentsChunkFallback() {
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

const ProjectAgentsTab = lazyComponent(
  () =>
    import('@/app/features/projects/components/project-agents-tab').then(
      (mod) => ({ default: mod.ProjectAgentsTab }),
    ),
  { loading: () => <AgentsChunkFallback /> },
);

export const Route = createFileRoute(
  '/dashboard/$id/projects/$projectId/agents',
)({
  // Warm the tab chunk during the loader so it's cached by render time —
  // removes the Suspense fallback flash on first nav (tab links preload on
  // render, so this typically fires before the click). Fire-and-forget.
  loader: () => {
    void import('@/app/features/projects/components/project-agents-tab');
  },
  component: ProjectAgentsPage,
});

function ProjectAgentsPage() {
  const { id: organizationId, projectId } = Route.useParams();
  return (
    <ProjectAgentsTab
      organizationId={organizationId}
      projectId={asProjectId(projectId)}
    />
  );
}
