import { createFileRoute } from '@tanstack/react-router';

import { AppsGrid } from '@/app/features/apps/components/apps-grid';

export const Route = createFileRoute('/dashboard/$id/apps/')({
  component: AppsIndexPage,
});

function AppsIndexPage() {
  const { id: organizationId } = Route.useParams();
  return (
    <div className="p-4">
      <AppsGrid organizationId={organizationId} />
    </div>
  );
}
