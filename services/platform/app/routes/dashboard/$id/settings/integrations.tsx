import { convexQuery } from '@convex-dev/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

import { AccessDenied } from '@/app/components/layout/access-denied';
import { Skeleton } from '@/app/components/ui/feedback/skeleton';
import { Card } from '@/app/components/ui/layout/card';
import { Stack, Grid, HStack } from '@/app/components/ui/layout/layout';
import { IntegrationsClient } from '@/app/features/settings/integrations/components/integrations-client';
import {
  useIntegrations,
  useSsoProvider,
} from '@/app/features/settings/integrations/hooks/queries';
import { useCurrentMemberContext } from '@/app/hooks/use-current-member-context';
import { api } from '@/convex/_generated/api';
import { useT } from '@/lib/i18n/client';
import { seo } from '@/lib/utils/seo';

const searchSchema = z.object({
  tab: z.string().optional(),
});

export const Route = createFileRoute('/dashboard/$id/settings/integrations')({
  head: () => ({
    meta: seo('integrations'),
  }),
  validateSearch: searchSchema,
  loader: ({ context, params }) => {
    void context.queryClient.prefetchQuery(
      convexQuery(api.integrations.queries.list, {
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
          <HStack gap={2}>
            <Skeleton className="h-5 w-24" />
          </HStack>
          <div className="space-y-1">
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-5 w-4/5" />
          </div>
        </Stack>
      </Stack>
    </Card>
  );
}

function IntegrationsSkeleton() {
  return (
    <Stack>
      <Grid cols={1} md={2} lg={3}>
        {Array.from({ length: 4 }).map((_, i) => (
          <IntegrationCardSkeleton key={i} />
        ))}
      </Grid>
    </Stack>
  );
}

function IntegrationsPage() {
  const { id: organizationId } = Route.useParams();
  const { t } = useT('accessDenied');

  const { data: memberContext, isLoading: isMemberLoading } =
    useCurrentMemberContext(organizationId);
  const { integrations, isLoading: isIntegrationsLoading } =
    useIntegrations(organizationId);
  const { data: ssoProvider, isLoading: isSsoLoading } = useSsoProvider();

  if (
    isMemberLoading ||
    isIntegrationsLoading ||
    isSsoLoading ||
    !memberContext
  ) {
    return <IntegrationsSkeleton />;
  }

  const userRole = (memberContext.role ?? '').toLowerCase();
  const hasAccess = userRole === 'admin' || userRole === 'developer';

  if (!hasAccess) {
    return <AccessDenied message={t('integrations')} />;
  }

  return (
    <IntegrationsClient
      organizationId={organizationId}
      integrations={integrations}
      ssoProvider={ssoProvider ?? null}
    />
  );
}
