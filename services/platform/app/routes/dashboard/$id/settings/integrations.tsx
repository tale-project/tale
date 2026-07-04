import { convexQuery } from '@convex-dev/react-query';
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router';
import { Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { z } from 'zod';

import { useCatalogSync } from '@/app/components/catalog/use-catalog-sync';
import { AccessDenied } from '@/app/components/layout/access-denied';
import { DataTableActionMenu } from '@/app/components/ui/data-table/data-table-action-menu';
import { useOrganization } from '@/app/features/organization/hooks/queries';
import { SettingsPage } from '@/app/features/settings/components/settings-page';
import { SettingsSection } from '@/app/features/settings/components/settings-section';
import {
  type IntegrationListItem,
  Integrations,
} from '@/app/features/settings/integrations/components/integrations';
import {
  useIntegrationCredentials,
  useIntegrations,
} from '@/app/features/settings/integrations/hooks/queries';
import { mergeIntegrationListItem } from '@/app/features/settings/integrations/lib/merge-integration';
import { useAbility, useAbilityLoading } from '@/app/hooks/use-ability';
import { toast } from '@/app/hooks/use-toast';
import { api } from '@/convex/_generated/api';
import { useT } from '@/lib/i18n/client';
import { seo } from '@/lib/utils/seo';

const searchSchema = z.object({
  // Only `mcp-servers` is handled (redirected to the MCP page in
  // `beforeLoad`). `apps` was never read, so it isn't accepted.
  section: z.literal('mcp-servers').optional(),
  tab: z.string().optional(),
  slug: z.string().optional(),
  integration_oauth2: z.string().optional(),
  integration_oauth2_error: z.string().optional(),
  description: z.string().optional(),
});

export const Route = createFileRoute('/dashboard/$id/settings/integrations')({
  head: () => ({
    meta: seo('integrations'),
  }),
  validateSearch: searchSchema,
  beforeLoad: ({ params, search }) => {
    // MCP servers are now their own settings page; redirect the legacy
    // `?section=mcp-servers` deep link to keep old bookmarks working.
    if (search.section === 'mcp-servers') {
      throw redirect({
        to: '/dashboard/$id/settings/mcp',
        params: { id: params.id },
      });
    }
  },
  loader: ({ context, params }) => {
    void context.queryClient.prefetchQuery(
      convexQuery(api.integrations.credential_queries.list, {
        organizationId: params.id,
      }),
    );
  },
  component: IntegrationsPage,
});

function IntegrationsPage() {
  const { id: organizationId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate();
  const { t } = useT('accessDenied');
  const { t: tSettings } = useT('settings');
  const { t: tNav } = useT('navigation');

  const [addDialogOpen, setAddDialogOpen] = useState(false);

  const ability = useAbility();
  const abilityLoading = useAbilityLoading();

  const { isLoading: isOrgLoading } = useOrganization(organizationId);

  const {
    integrations: fileIntegrations,
    isLoading: isIntegrationsLoading,
    refetch: refetchIntegrations,
  } = useIntegrations(organizationId);
  const { data: credentials } = useIntegrationCredentials(organizationId);
  // "Update from catalog" lives inside the Add-integration dropdown (same
  // pattern as the agents catalog), not as a standalone header button.
  const { menuItem: syncItem, dialog: syncDialog } = useCatalogSync({
    organizationId,
    domain: 'integrations',
    onSynced: () => refetchIntegrations(),
  });

  useEffect(() => {
    if (search.integration_oauth2 === 'success') {
      toast({
        title: tSettings('integrations.oauthConnectedTitle'),
        description: tSettings('integrations.oauthConnectedDescription'),
        variant: 'success',
      });
    } else if (search.integration_oauth2_error) {
      toast({
        title: tSettings('integrations.oauthErrorTitle'),
        description:
          search.description || tSettings('integrations.oauthErrorDescription'),
        variant: 'destructive',
      });
    }

    if (search.integration_oauth2 || search.integration_oauth2_error) {
      void navigate({
        from: Route.fullPath,
        search: { tab: search.tab },
        replace: true,
      });
    }
  }, [search.integration_oauth2, search.integration_oauth2_error]); // eslint-disable-line react-hooks/exhaustive-deps

  // Access is only knowable once the ability has loaded; until then the page
  // chrome (title + tabs) renders with a skeletonized card grid so nothing
  // shifts when access resolves and the real list streams in.
  if (!abilityLoading && ability.cannot('read', 'developerSettings')) {
    return <AccessDenied message={t('integrations')} />;
  }

  // The card grid masks while the ability, org, file list, or SSO read are in
  // flight — the list resolves under stable chrome instead of swapping in from
  // a separate page-level skeleton.
  const isAppsLoading = abilityLoading || isOrgLoading || isIntegrationsLoading;

  const credentialsBySlug = new Map(
    (credentials ?? []).map(
      (c: Record<string, unknown> & { slug: string }) => [c.slug, c] as const,
    ),
  );

  const validIntegrations = (fileIntegrations ?? []).filter(
    (item): item is Record<string, unknown> =>
      item != null &&
      typeof item === 'object' &&
      'title' in item &&
      'slug' in item,
  );

  const allIntegrations: IntegrationListItem[] = validIntegrations.map((item) =>
    mergeIntegrationListItem(
      item,
      credentialsBySlug.get(String(item.slug)),
      organizationId,
    ),
  );

  const handleTabChange = (tab: string) => {
    void navigate({
      from: Route.fullPath,
      search: { ...search, tab },
      replace: true,
    });
  };

  const clearSlugParam = () => {
    void navigate({
      from: Route.fullPath,
      search: { ...search, slug: undefined },
      replace: true,
    });
  };

  return (
    <SettingsPage>
      <SettingsSection
        title={tNav('integrations')}
        description={tSettings('integrations.pageSubtitle')}
        action={
          <DataTableActionMenu
            label={tSettings('integrations.addCustomIntegration')}
            icon={Plus}
            menuItems={[
              {
                label: tSettings('integrations.addMenu.custom'),
                icon: Plus,
                onClick: () => setAddDialogOpen(true),
              },
              ...(syncItem ? [syncItem] : []),
            ]}
          />
        }
      >
        <Integrations
          organizationId={organizationId}
          integrations={allIntegrations}
          tab={search.tab ?? 'connected'}
          onTabChange={handleTabChange}
          initialSlug={search.slug}
          onInitialSlugConsumed={clearSlugParam}
          isLoading={isAppsLoading}
          addDialogOpen={addDialogOpen}
          onAddDialogOpenChange={setAddDialogOpen}
        />
        {syncDialog}
      </SettingsSection>
    </SettingsPage>
  );
}
