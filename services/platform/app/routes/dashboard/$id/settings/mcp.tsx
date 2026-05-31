import { convexQuery } from '@convex-dev/react-query';
import { Button } from '@tale/ui/button';
import { createFileRoute } from '@tanstack/react-router';
import { Plus } from 'lucide-react';
import { useState } from 'react';

import { AccessDenied } from '@/app/components/layout/access-denied';
import { SettingsPage } from '@/app/features/settings/components/settings-page';
import { McpServers } from '@/app/features/settings/mcp-servers/components/mcp-servers';
import { useAbility, useAbilityLoading } from '@/app/hooks/use-ability';
import { api } from '@/convex/_generated/api';
import { useT } from '@/lib/i18n/client';
import { seo } from '@/lib/utils/seo';

export const Route = createFileRoute('/dashboard/$id/settings/mcp')({
  head: () => ({
    meta: seo('mcpServers'),
  }),
  loader: ({ context, params }) => {
    void context.queryClient.prefetchQuery(
      convexQuery(api.mcp_servers.queries.list, {
        organizationId: params.id,
      }),
    );
  },
  component: McpPage,
});

function McpPage() {
  const { id: organizationId } = Route.useParams();
  const { t: tAccess } = useT('accessDenied');
  const { t: tNav } = useT('navigation');
  const { t: tMcp } = useT('mcpServers');

  const [addDialogOpen, setAddDialogOpen] = useState(false);

  const ability = useAbility();
  const abilityLoading = useAbilityLoading();

  if (!abilityLoading && ability.cannot('read', 'developerSettings')) {
    return <AccessDenied message={tAccess('integrations')} />;
  }

  return (
    <SettingsPage
      title={tNav('mcp')}
      description={tMcp('description')}
      headerAction={
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
    </SettingsPage>
  );
}
