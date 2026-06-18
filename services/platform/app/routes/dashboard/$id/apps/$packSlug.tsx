import { createFileRoute } from '@tanstack/react-router';

import { PackPage } from '@/app/features/apps/components/pack-page';

export const Route = createFileRoute('/dashboard/$id/apps/$packSlug')({
  component: PackRoute,
});

function PackRoute() {
  const { id: organizationId, packSlug } = Route.useParams();
  return (
    <div className="p-4">
      <PackPage organizationId={organizationId} packSlug={packSlug} />
    </div>
  );
}
