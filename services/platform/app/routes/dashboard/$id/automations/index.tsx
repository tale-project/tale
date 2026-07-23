import { createFileRoute } from '@tanstack/react-router';

import { AutomationsList } from '@/app/features/automations/components/automations-list';

export const Route = createFileRoute('/dashboard/$id/automations/')({
  component: AutomationsIndexPage,
});

function AutomationsIndexPage() {
  const { id: organizationId } = Route.useParams();
  return <AutomationsList organizationId={organizationId} />;
}
