import { convexQuery } from '@convex-dev/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useAction } from 'convex/react';
import { useEffect, useRef } from 'react';
import { z } from 'zod';

import { AccessDenied } from '@/app/components/layout/access-denied';
import { Skeleton } from '@/app/components/ui/feedback/skeleton';
import { Card } from '@/app/components/ui/layout/card';
import { Grid, HStack, Stack } from '@/app/components/ui/layout/layout';
import {
  type IntegrationListItem,
  Integrations,
} from '@/app/features/settings/integrations/components/integrations';
import {
  useIntegrationCredentials,
  useIntegrations,
  useSsoProvider,
} from '@/app/features/settings/integrations/hooks/queries';
import { useAbility } from '@/app/hooks/use-ability';
import { toast } from '@/app/hooks/use-toast';
import { api } from '@/convex/_generated/api';
import { useT } from '@/lib/i18n/client';
import { seo } from '@/lib/utils/seo';

const searchSchema = z.object({
  tab: z.string().optional(),
  integration_oauth2: z.string().optional(),
  integration_oauth2_error: z.string().optional(),
  description: z.string().optional(),
});

export const Route = createFileRoute('/dashboard/$id/settings/integrations')({
  head: () => ({
    meta: seo('integrations'),
  }),
  validateSearch: searchSchema,
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

function IntegrationCardSkeleton() {
  return (
    <Card
      className="flex flex-col justify-between"
      contentClassName="p-5"
      footer={
        <HStack justify="between" className="w-full">
          <Skeleton className="h-6 w-20" />
          <Skeleton className="h-5 w-9 rounded-full" />
        </HStack>
      }
      footerClassName="border-border border-t px-5 py-4"
    >
      <Stack gap={3}>
        <div className="border-border flex h-11 w-11 items-center justify-center rounded-md border">
          <Skeleton className="size-6 rounded-sm" />
        </div>
        <Stack gap={1}>
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-5 w-full" />
          <Skeleton className="h-5 w-4/5" />
        </Stack>
      </Stack>
    </Card>
  );
}

function IntegrationsSkeleton() {
  return (
    <Grid cols={1} md={2} lg={3}>
      {Array.from({ length: 4 }).map((_, i) => (
        <IntegrationCardSkeleton key={i} />
      ))}
    </Grid>
  );
}

function IntegrationsPage() {
  const { id: organizationId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate();
  const { t } = useT('accessDenied');
  const { t: tSettings } = useT('settings');

  const ability = useAbility();

  const { integrations: fileIntegrations, isLoading: isIntegrationsLoading } =
    useIntegrations('default');
  const { data: credentials } = useIntegrationCredentials(organizationId);
  const { data: ssoProvider, isLoading: isSsoLoading } = useSsoProvider();

  // Auto-create missing credential records for installed integrations
  const installFn = useAction(api.integrations.file_actions.installIntegration);
  const ensuredRef = useRef(new Set<string>());
  useEffect(() => {
    if (!credentials || !fileIntegrations.length) return;
    const credSlugs = new Set((credentials ?? []).map((c) => c.slug));
    for (const item of fileIntegrations) {
      if (!item || !('slug' in item)) continue;
      const { slug } = item;
      if (!credSlugs.has(slug) && !ensuredRef.current.has(slug)) {
        ensuredRef.current.add(slug);
        void installFn({ orgSlug: 'default', slug, organizationId });
      }
    }
  }, [fileIntegrations, credentials, installFn, organizationId]);

  // Handle OAuth2 redirect query params
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

    // Clean up OAuth query params from URL
    if (search.integration_oauth2 || search.integration_oauth2_error) {
      void navigate({
        from: Route.fullPath,
        search: { tab: search.tab },
        replace: true,
      });
    }
  }, [search.integration_oauth2, search.integration_oauth2_error]); // eslint-disable-line react-hooks/exhaustive-deps

  if (ability.cannot('read', 'developerSettings')) {
    return <AccessDenied message={t('integrations')} />;
  }

  if (isIntegrationsLoading || isSsoLoading) {
    return <IntegrationsSkeleton />;
  }

  // Merge file-based integration config with DB credential records
  // so each item has the real credential _id for API calls
  const credentialsBySlug = new Map(
    (credentials ?? []).map((c) => [c.slug, c]),
  );

  const validIntegrations = (
    fileIntegrations as (Record<string, unknown> | null)[]
  ).filter(
    (item): item is Record<string, unknown> =>
      item != null && 'title' in item && 'slug' in item,
  );
  const mergedIntegrations = validIntegrations.map((item) => {
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
      oauth2Config: cred?.oauth2Config,
      basicAuth: cred?.basicAuth,
      apiKeyAuth: cred?.apiKeyAuth,
      oauth2Auth: cred?.oauth2Auth,
      connectionConfig: cred?.connectionConfig,
      sqlConnectionConfig: cred?.sqlConnectionConfig,
    };
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- merging file + DB data into IntegrationListItem shape
  }) as unknown as IntegrationListItem[];

  return (
    <Integrations
      organizationId={organizationId}
      integrations={mergedIntegrations}
      ssoProvider={ssoProvider ?? null}
    />
  );
}
