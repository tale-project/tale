import { createFileRoute } from '@tanstack/react-router';

import { ProvidersTable } from '@/app/features/settings/providers/components/providers-table';

export const Route = createFileRoute('/dashboard/$id/settings/providers/')({
  component: ProvidersIndexRoute,
});

function ProvidersIndexRoute() {
  const { id } = Route.useParams();
  return <ProvidersTable organizationId={id} />;
}
