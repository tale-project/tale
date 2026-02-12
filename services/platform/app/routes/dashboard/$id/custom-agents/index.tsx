import { createFileRoute } from '@tanstack/react-router';

import { ContentWrapper } from '@/app/components/layout/content-wrapper';
import { CustomAgentTable } from '@/app/features/custom-agents/components/custom-agent-table';
import { useCustomAgentCollection } from '@/app/features/custom-agents/hooks/collections';
import { useCustomAgents } from '@/app/features/custom-agents/hooks/queries';

export const Route = createFileRoute('/dashboard/$id/custom-agents/')({
  component: CustomAgentsIndexPage,
});

function CustomAgentsIndexPage() {
  const { id: organizationId } = Route.useParams();
  const customAgentCollection = useCustomAgentCollection(organizationId);
  const { agents, isLoading } = useCustomAgents(customAgentCollection);

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
