import { createFileRoute } from '@tanstack/react-router';
import { CustomAgentWebhookSection } from '@/app/features/custom-agents/components/custom-agent-webhook-section';

export const Route = createFileRoute(
  '/dashboard/$id/custom-agents/$agentId/webhook',
)({
  component: WebhookTab,
});

function WebhookTab() {
  const { id: organizationId, agentId } = Route.useParams();

  return (
    <CustomAgentWebhookSection
      organizationId={organizationId}
      agentId={agentId}
    />
  );
}
