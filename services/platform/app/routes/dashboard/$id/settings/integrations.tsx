import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from 'convex/react';
import { z } from 'zod';
import { api } from '@/convex/_generated/api';
import { IntegrationsClient } from '@/app/features/settings/integrations/components/integrations-client';
import { AccessDenied } from '@/app/components/layout/access-denied';
import { Skeleton } from '@/app/components/ui/feedback/skeleton';
import { Stack, Grid, HStack } from '@/app/components/ui/layout/layout';
import { Card, CardContent, CardFooter } from '@/app/components/ui/layout/card';
import { useT } from '@/lib/i18n/client';

const searchSchema = z.object({
  tab: z.string().optional(),
});

export const Route = createFileRoute('/dashboard/$id/settings/integrations')({
  validateSearch: searchSchema,
  component: IntegrationsPage,
});

function IntegrationCardSkeleton() {
  return (
    <Card className="flex flex-col justify-between">
      <CardContent className="p-5">
        <Stack gap={3}>
          <div className="w-11 h-11 border border-border rounded-md flex items-center justify-center">
            <Skeleton className="size-6 rounded-sm" />
          </div>
          <Stack gap={1}>
            <Skeleton className="h-5 w-24" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-4/5" />
          </Stack>
        </Stack>
      </CardContent>
      <CardFooter className="border-t border-border px-5 py-4">
        <HStack justify="between" className="w-full">
          <Skeleton className="h-6 w-20" />
          <Skeleton className="h-5 w-9 rounded-full" />
        </HStack>
      </CardFooter>
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
  const { tab } = Route.useSearch();
  const { t } = useT('accessDenied');

  const memberContext = useQuery(api.members.queries.getCurrentMemberContext, {
    organizationId,
  });
  const shopify = useQuery(api.integrations.queries.get_by_name.getByName, {
    organizationId,
    name: 'shopify',
  });
  const circuly = useQuery(api.integrations.queries.get_by_name.getByName, {
    organizationId,
    name: 'circuly',
  });
  const protel = useQuery(api.integrations.queries.get_by_name.getByName, {
    organizationId,
    name: 'protel',
  });
  const emailProviders = useQuery(api.email_providers.queries.list, { organizationId });
  const ssoProvider = useQuery(api.sso_providers.queries.get, {});

  if (
    memberContext === undefined ||
    memberContext === null ||
    shopify === undefined ||
    circuly === undefined ||
    protel === undefined ||
    emailProviders === undefined ||
    ssoProvider === undefined
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
      shopify={shopify}
      circuly={circuly}
      protel={protel}
      emailProviders={emailProviders}
      ssoProvider={ssoProvider}
      tab={tab}
    />
  );
}
