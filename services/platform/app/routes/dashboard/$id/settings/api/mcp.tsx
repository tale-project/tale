import { createFileRoute } from '@tanstack/react-router';

import { SettingsPage } from '@/app/features/settings/components/settings-page';
import { McpEndpointSection } from '@/app/features/settings/integrations/components/mcp-endpoint-section';
import { seo } from '@/lib/utils/seo';

export const Route = createFileRoute('/dashboard/$id/settings/api/mcp')({
  head: () => ({ meta: seo('mcp') }),
  component: ApiMcpPage,
});

// The MCP endpoint is an API surface — how external agent hosts reach this
// workspace — so it lives with the other API settings, not among the
// per-service integrations.
function ApiMcpPage() {
  const { id: organizationId } = Route.useParams();
  return (
    <SettingsPage>
      <McpEndpointSection organizationId={organizationId} />
    </SettingsPage>
  );
}
