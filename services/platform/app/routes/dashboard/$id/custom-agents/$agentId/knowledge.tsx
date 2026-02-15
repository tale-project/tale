import { createFileRoute } from '@tanstack/react-router';

import { CustomAgentKnowledge } from '@/app/features/custom-agents/components/custom-agent-knowledge';
import { seo } from '@/lib/utils/seo';

export const Route = createFileRoute(
  '/dashboard/$id/custom-agents/$agentId/knowledge',
)({
  head: () => ({
    meta: seo({
      title: 'Agent knowledge - Tale',
      description: 'Manage knowledge base access for your custom agent.',
    }),
  }),
  component: KnowledgeTab,
});

function KnowledgeTab() {
  const { id: organizationId, agentId } = Route.useParams();

  return (
    <CustomAgentKnowledge organizationId={organizationId} agentId={agentId} />
  );
}
