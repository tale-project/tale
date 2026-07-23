import { createFileRoute } from '@tanstack/react-router';

import { AgentKnowledgeTab } from '@/app/features/agents/components/agent-knowledge-tab';
import { seo } from '@/lib/utils/seo';

export const Route = createFileRoute(
  '/dashboard/$id/agents/$agentId/knowledge',
)({
  head: () => ({
    meta: seo('agentKnowledge'),
  }),
  component: AgentKnowledgePage,
});

function AgentKnowledgePage() {
  const { id: organizationId, agentId: slug } = Route.useParams();
  return <AgentKnowledgeTab organizationId={organizationId} slug={slug} />;
}
