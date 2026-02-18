import { convexQuery } from '@convex-dev/react-query';
import { createFileRoute } from '@tanstack/react-router';

import { CustomAgentTable } from '@/app/features/custom-agents/components/custom-agent-table';
import { CustomAgentsEmptyState } from '@/app/features/custom-agents/components/custom-agents-empty-state';
import {
  useApproxCustomAgentCount,
  useCustomAgents,
} from '@/app/features/custom-agents/hooks/queries';
import { api } from '@/convex/_generated/api';

export const Route = createFileRoute('/dashboard/$id/custom-agents/')({
  loader: async ({ context, params }) => {
    void context.queryClient.prefetchQuery(
      convexQuery(api.custom_agents.queries.listCustomAgents, {
        organizationId: params.id,
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

  const { data: count } = useApproxCustomAgentCount(organizationId);

  const { agents } = useCustomAgents(organizationId);

  if (count === 0) {
    return <CustomAgentsEmptyState organizationId={organizationId} />;
  }

  return <CustomAgentTable organizationId={organizationId} agents={agents} />;
}
