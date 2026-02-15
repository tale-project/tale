import { convexQuery } from '@convex-dev/react-query';
import { createFileRoute } from '@tanstack/react-router';

import { ContentWrapper } from '@/app/components/layout/content-wrapper';
import { CustomAgentTable } from '@/app/features/custom-agents/components/custom-agent-table';
import { CustomAgentsEmptyState } from '@/app/features/custom-agents/components/custom-agents-empty-state';
import { CustomAgentsTableSkeleton } from '@/app/features/custom-agents/components/custom-agents-table-skeleton';
import { useCustomAgents } from '@/app/features/custom-agents/hooks/queries';
import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { api } from '@/convex/_generated/api';

export const Route = createFileRoute('/dashboard/$id/custom-agents/')({
  loader: async ({ context, params }) => {
    void context.queryClient.prefetchQuery(
      convexQuery(api.custom_agents.queries.listCustomAgents, {
        organizationId: params.id,
      }),
    );
    await context.queryClient.ensureQueryData(
      convexQuery(api.custom_agents.queries.countCustomAgents, {
        organizationId: params.id,
      }),
    );
  },
  component: CustomAgentsIndexPage,
});

function CustomAgentsIndexPage() {
  const { id: organizationId } = Route.useParams();
  const { agents, isLoading } = useCustomAgents(organizationId);

  const { data: count } = useConvexQuery(
    api.custom_agents.queries.countCustomAgents,
    { organizationId },
  );

  if (isLoading) {
    if (count === 0) {
      return (
        <ContentWrapper className="p-4">
          <CustomAgentsEmptyState organizationId={organizationId} />
        </ContentWrapper>
      );
    }
    return (
      <ContentWrapper>
        <CustomAgentsTableSkeleton
          organizationId={organizationId}
          rows={Math.min(count ?? 10, 10)}
        />
      </ContentWrapper>
    );
  }

  if (agents && agents.length === 0) {
    return (
      <ContentWrapper className="p-4">
        <CustomAgentsEmptyState organizationId={organizationId} />
      </ContentWrapper>
    );
  }

  return (
    <ContentWrapper>
      <CustomAgentTable
        organizationId={organizationId}
        agents={agents ?? null}
        isLoading={isLoading}
      />
    </ContentWrapper>
  );
}
