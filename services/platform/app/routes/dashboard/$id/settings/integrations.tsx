import { convexQuery } from '@convex-dev/react-query';
import { Button } from '@tale/ui/button';
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { z } from 'zod';

import { AccessDenied } from '@/app/components/layout/access-denied';
import { useOrganization } from '@/app/features/organization/hooks/queries';
import { SettingsPage } from '@/app/features/settings/components/settings-page';
import { getTemplateIconUrl } from '@/app/features/settings/integrations/components/integration-upload/constants/integration-templates';
import {
  type IntegrationListItem,
  Integrations,
} from '@/app/features/settings/integrations/components/integrations';
import {
  useIntegrationCredentials,
  useIntegrations,
  useSsoProvider,
} from '@/app/features/settings/integrations/hooks/queries';
import { useAbility, useAbilityLoading } from '@/app/hooks/use-ability';
import { toast } from '@/app/hooks/use-toast';
import { api } from '@/convex/_generated/api';
import { useT } from '@/lib/i18n/client';
import { seo } from '@/lib/utils/seo';
import { isRecord } from '@/lib/utils/type-guards';

const searchSchema = z.object({
  section: z.enum(['apps', 'mcp-servers']).optional(),
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
    void context.queryClient.prefetchQuery(
      convexQuery(api.sso_providers.queries.get, {}),
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

  const { integrations: fileIntegrations, isLoading: isIntegrationsLoading } =
    useIntegrations(organizationId);
  const { data: credentials } = useIntegrationCredentials(organizationId);
  const { data: ssoProvider, isLoading: isSsoLoading } = useSsoProvider();

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
  const isAppsLoading =
    abilityLoading || isOrgLoading || isIntegrationsLoading || isSsoLoading;

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

  const mergeConfig = (fileVal: unknown, credVal: unknown): unknown => {
    if (isRecord(credVal) && isRecord(fileVal)) {
      return { ...fileVal, ...credVal };
    }
    return credVal ?? fileVal;
  };

  // oxlint-disable-next-line oxc/no-map-spread, typescript/no-unsafe-type-assertion -- immutable update, type verified by filter
  const allIntegrations: IntegrationListItem[] = validIntegrations.map(
    (item) => {
      const slug = String(item.slug);
      const cred = credentialsBySlug.get(slug);
      return {
        ...item,
        _id: cred?._id ?? slug,
        name: slug,
        organizationId,
        isActive: cred?.isActive ?? false,
        status: cred?.status ?? 'inactive',
        authMethod: cred?.authMethod ?? item.authMethod,
        oauth2Config: mergeConfig(item.oauth2Config, cred?.oauth2Config),
        basicAuth: cred?.basicAuth ?? item.basicAuth,
        apiKeyAuth: cred?.apiKeyAuth ?? item.apiKeyAuth,
        oauth2Auth: cred?.oauth2Auth ?? item.oauth2Auth,
        connectionConfig: mergeConfig(
          item.connectionConfig,
          cred?.connectionConfig,
        ),
        sqlConnectionConfig: mergeConfig(
          item.sqlConnectionConfig,
          cred?.sqlConnectionConfig,
        ),
        iconUrl:
          typeof item.iconUrl === 'string'
            ? item.iconUrl
            : getTemplateIconUrl(slug),
      };
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- merging file + DB data into IntegrationListItem shape
    },
  ) as unknown as IntegrationListItem[];

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
    <SettingsPage
      title={tNav('integrations')}
      description={tSettings('integrations.pageSubtitle')}
      headerAction={
        <Button onClick={() => setAddDialogOpen(true)}>
          {tSettings('integrations.addCustomIntegration')}
        </Button>
      }
    >
      <Integrations
        organizationId={organizationId}
        integrations={allIntegrations}
        ssoProvider={ssoProvider ?? null}
        tab={search.tab ?? 'connected'}
        onTabChange={handleTabChange}
        initialSlug={search.slug}
        onInitialSlugConsumed={clearSlugParam}
        isLoading={isAppsLoading}
        addDialogOpen={addDialogOpen}
        onAddDialogOpenChange={setAddDialogOpen}
      />
    </SettingsPage>
  );
}
