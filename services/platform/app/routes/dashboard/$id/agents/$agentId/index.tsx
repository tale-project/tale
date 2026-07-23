import { createFileRoute } from '@tanstack/react-router';

import { AgentGeneralTab } from '@/app/features/agents/components/agent-general-tab';
import { seo } from '@/lib/utils/seo';

export const Route = createFileRoute('/dashboard/$id/agents/$agentId/')({
  head: () => ({
    meta: seo('agentSettings'),
  }),
  component: AgentGeneralPage,
});

function AgentGeneralPage() {
  const { id: organizationId, agentId: slug } = Route.useParams();
  return <AgentGeneralTab organizationId={organizationId} slug={slug} />;
}
