import { createFileRoute } from '@tanstack/react-router';

import { AgentResponseTuning } from '@/app/features/agents/components/agent-response-tuning';
import { seo } from '@/lib/utils/seo';

export const Route = createFileRoute(
  '/dashboard/$id/agents/$agentId/response-tuning',
)({
  head: () => ({
    meta: seo('agentResponseTuning'),
  }),
  component: ResponseTuningTab,
});

function ResponseTuningTab() {
  const { id: organizationId, agentId } = Route.useParams();

  return (
    <AgentResponseTuning organizationId={organizationId} agentId={agentId} />
  );
}
