import { createFileRoute } from '@tanstack/react-router';

import { AppPage } from '@/app/features/apps/components/app-page';

export const Route = createFileRoute('/dashboard/$id/apps/$appSlug')({
  component: AppRoute,
});

function AppRoute() {
  const { id: organizationId, appSlug } = Route.useParams();
  return (
    <div className="p-4">
      <AppPage organizationId={organizationId} appSlug={appSlug} />
    </div>
  );
}
