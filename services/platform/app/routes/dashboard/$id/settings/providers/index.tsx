import { createFileRoute } from '@tanstack/react-router';

import { ProvidersSettings } from '@/app/features/settings/providers/components/providers-settings';

export const Route = createFileRoute('/dashboard/$id/settings/providers/')({
  component: ProvidersPage,
});

function ProvidersPage() {
  const { id: organizationId } = Route.useParams();
  return <ProvidersSettings organizationId={organizationId} />;
}
