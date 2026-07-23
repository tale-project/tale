import { createFileRoute } from '@tanstack/react-router';

import { AgentToolsTab } from '@/app/features/agents/components/agent-tools-tab';
import { seo } from '@/lib/utils/seo';

export const Route = createFileRoute('/dashboard/$id/agents/$agentId/tools')({
  head: () => ({
    meta: seo('agentTools'),
  }),
  component: AgentToolsPage,
});

function AgentToolsPage() {
  const { id: organizationId, agentId: slug } = Route.useParams();
  return <AgentToolsTab organizationId={organizationId} slug={slug} />;
}
