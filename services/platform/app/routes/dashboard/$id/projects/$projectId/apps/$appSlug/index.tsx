import { createFileRoute } from '@tanstack/react-router';

import { AppPage } from '@/app/features/apps/components/app-page';

export const Route = createFileRoute(
  '/dashboard/$id/projects/$projectId/apps/$appSlug/',
)({
  component: ProjectAppIndexRoute,
});

/**
 * A project-scoped app's page, reached from its tab in the project shell. The
 * bound project comes straight from the URL and flows into `AppRuntime` as
 * `$projectId`, so the app's views/actions scope to this project.
 */
function ProjectAppIndexRoute() {
  const { id: organizationId, projectId, appSlug } = Route.useParams();
  return (
    <AppPage
      organizationId={organizationId}
      appSlug={appSlug}
      projectId={projectId}
    />
  );
}
