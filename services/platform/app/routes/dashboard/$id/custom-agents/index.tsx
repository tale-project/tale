import { createFileRoute } from '@tanstack/react-router';
import { CustomAgentTable } from '@/app/features/custom-agents/components/custom-agent-table';
import { useListCustomAgents } from '@/app/features/custom-agents/hooks/use-list-custom-agents';
import { ContentWrapper } from '@/app/components/layout/content-wrapper';

export const Route = createFileRoute('/dashboard/$id/custom-agents/')({
  component: CustomAgentsIndexPage,
});

function CustomAgentsIndexPage() {
  const { id: organizationId } = Route.useParams();
  const { agents, isLoading } = useListCustomAgents(organizationId);

  return (
    <ContentWrapper>
      <CustomAgentTable
        organizationId={organizationId}
        agents={agents}
        isLoading={isLoading}
      />
    </ContentWrapper>
  );
}
