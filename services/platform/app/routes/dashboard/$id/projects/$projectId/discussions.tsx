import { SkeletonText } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { StickySectionHeader } from '@tale/ui/sticky-section-header';
import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

import { ContentArea } from '@/app/components/layout/content-area';
import { asProjectId } from '@/app/features/projects/hooks/use-project-id-param';
import { lazyComponent } from '@/lib/utils/lazy-component';

const searchSchema = z.object({
  thread: z.string().optional(),
});

function DiscussionsChunkFallback() {
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

const ProjectDiscussionsTab = lazyComponent(
  () =>
    import('@/app/features/discussions/components/project-discussions-tab').then(
      (mod) => ({ default: mod.ProjectDiscussionsTab }),
    ),
  { loading: () => <DiscussionsChunkFallback /> },
);

export const Route = createFileRoute(
  '/dashboard/$id/projects/$projectId/discussions',
)({
  validateSearch: searchSchema,
  loader: () => {
    void import('@/app/features/discussions/components/project-discussions-tab');
  },
  component: ProjectDiscussionsPage,
});

function ProjectDiscussionsPage() {
  const { id: organizationId, projectId } = Route.useParams();
  const { thread } = Route.useSearch();
  return (
    <ProjectDiscussionsTab
      organizationId={organizationId}
      projectId={asProjectId(projectId)}
      initialThreadId={thread}
    />
  );
}
