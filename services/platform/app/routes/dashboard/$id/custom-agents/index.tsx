import { createFileRoute } from '@tanstack/react-router';

import { ContentWrapper } from '@/app/components/layout/content-wrapper';
import { CustomAgentTable } from '@/app/features/custom-agents/components/custom-agent-table';
import { CustomAgentsEmptyState } from '@/app/features/custom-agents/components/custom-agents-empty-state';
import { CustomAgentsTableSkeleton } from '@/app/features/custom-agents/components/custom-agents-table-skeleton';
import { useCustomAgentCollection } from '@/app/features/custom-agents/hooks/collections';
import { useCustomAgents } from '@/app/features/custom-agents/hooks/queries';

export const Route = createFileRoute('/dashboard/$id/custom-agents/')({
  component: CustomAgentsIndexPage,
});

function CustomAgentsIndexPage() {
  const { id: organizationId } = Route.useParams();
  const customAgentCollection = useCustomAgentCollection(organizationId);
  const { agents, isLoading } = useCustomAgents(customAgentCollection);

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
        agents={agents}
        isLoading={isLoading}
        collection={customAgentCollection}
      />
    </ContentWrapper>
  );
}
