import { SkeletonText } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { createFileRoute } from '@tanstack/react-router';

import { ContentArea } from '@/app/components/layout/content-area';
import { asProjectId } from '@/app/features/projects/hooks/use-project-id-param';
import { lazyComponent } from '@/lib/utils/lazy-component';

function SecretsChunkFallback() {
  return (
    <ContentArea variant="narrow" gap={6} className="py-6">
      <Skeletonize loading>
        <SkeletonText lines={1} />
        <SkeletonText lines={3} />
      </Skeletonize>
    </ContentArea>
  );
}

const ProjectSecretsTab = lazyComponent(
  () =>
    import('@/app/features/projects/components/project-secrets-tab').then(
      (mod) => ({ default: mod.ProjectSecretsTab }),
    ),
  { loading: () => <SecretsChunkFallback /> },
);

export const Route = createFileRoute(
  '/dashboard/$id/projects/$projectId/secrets',
)({
  component: ProjectSecretsPage,
});

function ProjectSecretsPage() {
  const { id: organizationId, projectId } = Route.useParams();
  return (
    <ProjectSecretsTab
      organizationId={organizationId}
      projectId={asProjectId(projectId)}
    />
  );
}
