import { SkeletonText } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { StickySectionHeader } from '@tale/ui/sticky-section-header';
import { createFileRoute } from '@tanstack/react-router';

import { ContentArea } from '@/app/components/layout/content-area';
import { asProjectId } from '@/app/features/projects/hooks/use-project-id-param';
import { lazyComponent } from '@/lib/utils/lazy-component';

// Skeletonized layout frame shown while the tab's JS chunk loads — the real
// tab (with its own data-loading mask) takes over once the chunk resolves.
function FilesChunkFallback() {
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

// §8: lazy-load tab content. Overview stays eager (default landing); the
// other tabs are bundled on first navigation only.
const ProjectFilesTab = lazyComponent(
  () =>
    import('@/app/features/projects/components/project-files-tab').then(
      (mod) => ({ default: mod.ProjectFilesTab }),
    ),
  { loading: () => <FilesChunkFallback /> },
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
