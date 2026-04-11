import { convexQuery } from '@convex-dev/react-query';
import { createFileRoute } from '@tanstack/react-router';

import { AccessDenied } from '@/app/components/layout/access-denied';
import { McpServers } from '@/app/features/settings/mcp-servers/components/mcp-servers';
import { useAbility, useAbilityLoading } from '@/app/hooks/use-ability';
import { api } from '@/convex/_generated/api';
import { useT } from '@/lib/i18n/client';
import { seo } from '@/lib/utils/seo';

export const Route = createFileRoute('/dashboard/$id/settings/mcp-servers')({
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
  component: McpServersPage,
});

function McpServersPage() {
  const { id: organizationId } = Route.useParams();
  const { t } = useT('accessDenied');

  const ability = useAbility();
  const abilityLoading = useAbilityLoading();

  if (abilityLoading) return null;

  if (ability.cannot('read', 'developerSettings')) {
    return <AccessDenied message={t('mcpServers')} />;
  }

  return <McpServers organizationId={organizationId} />;
}
