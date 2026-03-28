import { createFileRoute } from '@tanstack/react-router';

import { AgentsTable } from '@/app/features/agents/components/agents-table';
import { seo } from '@/lib/utils/seo';

export const Route = createFileRoute('/dashboard/$id/agents/')({
  head: () => ({
    meta: seo('agents'),
  }),
  component: AgentsPage,
});

function AgentsPage() {
  const { id: organizationId } = Route.useParams();

  return <AgentsTable organizationId={organizationId} />;
}
