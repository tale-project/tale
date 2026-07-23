import { createFileRoute } from '@tanstack/react-router';

import { AgentInstructionsTab } from '@/app/features/agents/components/agent-instructions-tab';
import { seo } from '@/lib/utils/seo';

export const Route = createFileRoute(
  '/dashboard/$id/agents/$agentId/instructions',
)({
  head: () => ({
    meta: seo('agentInstructions'),
  }),
  component: AgentInstructionsPage,
});

function AgentInstructionsPage() {
  const { id: organizationId, agentId: slug } = Route.useParams();
  return <AgentInstructionsTab organizationId={organizationId} slug={slug} />;
}
