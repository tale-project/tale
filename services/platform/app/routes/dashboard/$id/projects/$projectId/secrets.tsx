import { lazyComponent } from '@tale/ui/lazy-component';
import { createFileRoute } from '@tanstack/react-router';

import { ProjectSecretsSkeleton } from '@/app/features/projects/components/project-secrets-layout';
import { asProjectId } from '@/app/features/projects/hooks/use-project-id-param';

// Skeletonized layout frame shown while the tab's JS chunk loads, so the
// content frame doesn't go blank between navigation and chunk-ready. It mirrors
// the real tab's shell — same content measure, same sticky header — so nothing
// shifts when the chunk resolves and takes over with its own data mask.

const ProjectSecretsTab = lazyComponent(
  () =>
    import('@/app/features/projects/components/project-secrets-tab').then(
      (mod) => ({ default: mod.ProjectSecretsTab }),
    ),
  { loading: () => <ProjectSecretsSkeleton /> },
);

export const Route = createFileRoute(
  '/dashboard/$id/projects/$projectId/secrets',
)({
  // Warm the tab chunk during the loader so it's cached by render time —
  // removes the Suspense fallback flash on first nav (tab links preload on
  // render, so this typically fires before the click). Fire-and-forget.
  loader: () => {
    void import('@/app/features/projects/components/project-secrets-tab');
  },
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
