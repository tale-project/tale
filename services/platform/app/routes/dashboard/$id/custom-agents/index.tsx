import { convexQuery } from '@convex-dev/react-query';
import { createFileRoute } from '@tanstack/react-router';

import { ContentWrapper } from '@/app/components/layout/content-wrapper';
import { CustomAgentTable } from '@/app/features/custom-agents/components/custom-agent-table';
import { CustomAgentsEmptyState } from '@/app/features/custom-agents/components/custom-agents-empty-state';
import { CustomAgentsTableSkeleton } from '@/app/features/custom-agents/components/custom-agents-table-skeleton';
import { useCustomAgents } from '@/app/features/custom-agents/hooks/queries';
import { api } from '@/convex/_generated/api';

export const Route = createFileRoute('/dashboard/$id/custom-agents/')({
  loader: ({ context, params }) => {
    void context.queryClient.prefetchQuery(
      convexQuery(api.custom_agents.queries.listCustomAgents, {
        organizationId: params.id,
      }),
    );
  },
  component: CustomAgentsIndexPage,
});

function CustomAgentsIndexPage() {
  const { id: organizationId } = Route.useParams();
  const { agents, isLoading } = useCustomAgents(organizationId);

  if (isLoading) {
    return (
      <ContentWrapper>
        <CustomAgentsTableSkeleton organizationId={organizationId} />
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
