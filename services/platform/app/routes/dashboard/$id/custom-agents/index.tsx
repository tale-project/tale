import { createFileRoute } from '@tanstack/react-router';

import { CustomAgentsTable } from '@/app/features/custom-agents/components/custom-agents-table';
import { seo } from '@/lib/utils/seo';

export const Route = createFileRoute('/dashboard/$id/custom-agents/')({
  head: () => ({
    meta: seo('customAgents'),
  }),
  component: CustomAgentsPage,
});

function CustomAgentsPage() {
  const { id: organizationId } = Route.useParams();

  return <CustomAgentsTable organizationId={organizationId} />;
}
