import { convexQuery } from '@convex-dev/react-query';
import { Button } from '@tale/ui/button';
import { createFileRoute } from '@tanstack/react-router';
import { Plus } from 'lucide-react';
import { useState } from 'react';

import { SettingsPage } from '@/app/features/settings/components/settings-page';
import { SettingsSection } from '@/app/features/settings/components/settings-section';
import { McpServers } from '@/app/features/settings/mcp-servers/components/mcp-servers';
import { api } from '@/convex/_generated/api';
import { useT } from '@/lib/i18n/client';
import { seo } from '@/lib/utils/seo';

export const Route = createFileRoute('/dashboard/$id/settings/api/mcp')({
  head: () => ({ meta: seo('mcpServers') }),
  loader: ({ context, params }) => {
    void context.queryClient.prefetchQuery(
      convexQuery(api.mcp_servers.queries.list, {
        organizationId: params.id,
      }),
    );
  },
  component: ApiMcpPage,
});

function ApiMcpPage() {
  const { id: organizationId } = Route.useParams();
  const { t: tNav } = useT('navigation');
  const { t: tMcp } = useT('mcpServers');

  const [addDialogOpen, setAddDialogOpen] = useState(false);

  // Access is gated by the parent `api` route layout. Section title (not a
  // page title) — the settings rail already names the page; the former
  // header action moves into the section header.
  // `fitToContainer` + section `flex-1` so EmptyState (flex-1 +
  // justify-center) sits in the middle of the pane below the section
  // header — same height chain as Integrations.
  return (
    <SettingsPage fitToContainer>
      <SettingsSection
        title={tNav('mcp')}
        description={tMcp('description')}
        className="min-h-0 flex-1"
        action={
          <Button onClick={() => setAddDialogOpen(true)}>
            <Plus className="mr-2 size-4" />
            {tMcp('addServer')}
          </Button>
        }
      >
        <McpServers
          organizationId={organizationId}
          addDialogOpen={addDialogOpen}
          onAddDialogOpenChange={setAddDialogOpen}
        />
      </SettingsSection>
    </SettingsPage>
  );
}
