import { createFileRoute } from '@tanstack/react-router';

import { CustomAgentWebhookSection } from '@/app/features/custom-agents/components/custom-agent-webhook-section';
import { seo } from '@/lib/utils/seo';

export const Route = createFileRoute(
  '/dashboard/$id/custom-agents/$agentId/webhook',
)({
  head: () => ({
    meta: seo('agentWebhook'),
  }),
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
