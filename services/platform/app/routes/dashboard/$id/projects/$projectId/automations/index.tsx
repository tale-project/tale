import { SkeletonText } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { StickySectionHeader } from '@tale/ui/sticky-section-header';
import { createFileRoute } from '@tanstack/react-router';

import { ContentArea } from '@/app/components/layout/content-area';
import { asProjectId } from '@/app/features/projects/hooks/use-project-id-param';
import { lazyComponent } from '@/lib/utils/lazy-component';

function AutomationsChunkFallback() {
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

const ProjectAutomationsTab = lazyComponent(
  () =>
    import('@/app/features/projects/components/project-automations-tab').then(
      (mod) => ({ default: mod.ProjectAutomationsTab }),
    ),
  { loading: () => <AutomationsChunkFallback /> },
);

export const Route = createFileRoute(
  '/dashboard/$id/projects/$projectId/automations/',
)({
  loader: () => {
    void import('@/app/features/projects/components/project-automations-tab');
  },
  component: ProjectAutomationsPage,
});

function ProjectAutomationsPage() {
  const { id: organizationId, projectId } = Route.useParams();
  return (
    <ProjectAutomationsTab
      organizationId={organizationId}
      projectId={asProjectId(projectId)}
    />
  );
}
