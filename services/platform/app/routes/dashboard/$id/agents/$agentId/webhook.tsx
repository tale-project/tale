import { createFileRoute } from '@tanstack/react-router';

import { AgentWebhookSection } from '@/app/features/agents/components/agent-webhook-section';
import { seo } from '@/lib/utils/seo';

export const Route = createFileRoute('/dashboard/$id/agents/$agentId/webhook')({
  head: () => ({
    meta: seo('agentWebhook'),
  }),
  component: WebhookTab,
});

function WebhookTab() {
  const { id: organizationId, agentId: agentFileName } = Route.useParams();

  return (
    <AgentWebhookSection
      organizationId={organizationId}
      agentFileName={agentFileName}
    />
  );
}
