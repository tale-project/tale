import { createFileRoute } from '@tanstack/react-router';

import { AgentKnowledge } from '@/app/features/agents/components/agent-knowledge';
import { seo } from '@/lib/utils/seo';

export const Route = createFileRoute(
  '/dashboard/$id/agents/$agentId/knowledge',
)({
  head: () => ({
    meta: seo('agentKnowledge'),
  }),
  component: KnowledgeTab,
});

function KnowledgeTab() {
  const { id: organizationId, agentId } = Route.useParams();

  return <AgentKnowledge organizationId={organizationId} agentId={agentId} />;
}
