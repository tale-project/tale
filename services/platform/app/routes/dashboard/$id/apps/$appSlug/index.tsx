import { createFileRoute } from '@tanstack/react-router';

import { AppPage } from '@/app/features/apps/components/app-page';

export const Route = createFileRoute('/dashboard/$id/apps/$appSlug/')({
  component: AppIndexRoute,
});

function AppIndexRoute() {
  const { id: organizationId, appSlug } = Route.useParams();
  return <AppPage organizationId={organizationId} appSlug={appSlug} />;
}
