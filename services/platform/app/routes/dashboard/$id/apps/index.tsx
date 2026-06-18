import { createFileRoute } from '@tanstack/react-router';

import { PacksGrid } from '@/app/features/apps/components/packs-grid';

export const Route = createFileRoute('/dashboard/$id/apps/')({
  component: AppsIndexPage,
});

function AppsIndexPage() {
  const { id: organizationId } = Route.useParams();
  return (
    <div className="p-4">
      <PacksGrid organizationId={organizationId} />
    </div>
  );
}
