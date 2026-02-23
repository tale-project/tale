import { convexQuery } from '@convex-dev/react-query';
import { createFileRoute } from '@tanstack/react-router';

import { CustomAgentsTable } from '@/app/features/custom-agents/components/custom-agents-table';
import { api } from '@/convex/_generated/api';
import { seo } from '@/lib/utils/seo';

export const Route = createFileRoute('/dashboard/$id/custom-agents/')({
  head: () => ({
    meta: seo('customAgents'),
  }),
  pendingComponent: () => null,
  pendingMs: 0,
  loader: async ({ context, params }) => {
    void context.queryClient.prefetchQuery(
      convexQuery(api.custom_agents.queries.listCustomAgentsPaginated, {
        organizationId: params.id,
        paginationOpts: { numItems: 10, cursor: null },
      }),
    );
    await context.queryClient.ensureQueryData(
      convexQuery(api.custom_agents.queries.approxCountCustomAgents, {
        organizationId: params.id,
      }),
    );
  },
  component: CustomAgentsPage,
});

function CustomAgentsPage() {
  const { id: organizationId } = Route.useParams();

  return <CustomAgentsTable organizationId={organizationId} />;
}
