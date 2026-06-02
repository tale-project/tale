import { createFileRoute } from '@tanstack/react-router';

import { VectorDatabaseSettings } from '@/app/features/settings/vector-database/components/vector-database-settings';

export const Route = createFileRoute('/dashboard/$id/settings/vector-database')(
  {
    component: VectorDatabaseSettingsPage,
  },
);

function VectorDatabaseSettingsPage() {
  const { id } = Route.useParams();
  // The container owns the orgSettings access check, the config read, and the
  // loading state, wrapping the form (+ deployment-scope banner) in
  // <Skeletonize>.
  return <VectorDatabaseSettings organizationId={id} />;
}
