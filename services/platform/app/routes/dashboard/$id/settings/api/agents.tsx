import { createFileRoute } from '@tanstack/react-router';

import { AgentConnectionsSection } from '@/app/features/settings/agent-connections/components/agent-connections-section';
import { agentConnectionsQuery } from '@/app/features/settings/agent-connections/hooks/queries';
import { SettingsPage } from '@/app/features/settings/components/settings-page';
import { seo } from '@/lib/utils/seo';

export const Route = createFileRoute('/dashboard/$id/settings/api/agents')({
  head: () => ({ meta: seo('connectedAgents') }),
  // Warm the table's own read without gating navigation on it: the table
  // owns loading and error recovery.
  loader: ({ context, params }) => {
    void context.queryClient.prefetchQuery(
      agentConnectionsQuery(params.id, { scope: 'mine', ended: false }),
    );
  },
  component: ApiAgentsPage,
});

function ApiAgentsPage() {
  const { id: organizationId } = Route.useParams();

  // Access is gated by the parent `api` route layout. A section title, not a
  // page title — the settings rail already names the page.
  return (
    <SettingsPage>
      <AgentConnectionsSection organizationId={organizationId} />
    </SettingsPage>
  );
}
