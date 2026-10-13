import { createFileRoute } from '@tanstack/react-router';

import { SettingsPage } from '@/app/features/settings/components/settings-page';
import { McpConnectSection } from '@/app/features/settings/connectors/components/mcp-connect-section';
import { McpEndpointSection } from '@/app/features/settings/connectors/components/mcp-endpoint-section';
import { seo } from '@/lib/utils/seo';

export const Route = createFileRoute('/dashboard/$id/settings/api/mcp')({
  head: () => ({ meta: seo('mcp') }),
  component: ApiMcpPage,
});

// The MCP endpoint is an API surface — how external agent hosts reach this
// workspace — so it lives with the other API settings, not among the
// per-service connectors. Where agents may sign in, the page starts with the
// way to connect one; the address and the key follow for everything else.
function ApiMcpPage() {
  const { id: organizationId } = Route.useParams();
  return (
    <SettingsPage>
      <McpConnectSection organizationId={organizationId} />
      <McpEndpointSection organizationId={organizationId} />
    </SettingsPage>
  );
}
