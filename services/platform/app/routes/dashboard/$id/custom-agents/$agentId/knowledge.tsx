import { createFileRoute } from '@tanstack/react-router';

import { CustomAgentKnowledge } from '@/app/features/custom-agents/components/custom-agent-knowledge';

export const Route = createFileRoute(
  '/dashboard/$id/custom-agents/$agentId/knowledge',
)({
  component: KnowledgeTab,
});

function KnowledgeTab() {
  const { id: organizationId, agentId } = Route.useParams();

  return (
    <CustomAgentKnowledge organizationId={organizationId} agentId={agentId} />
  );
}
