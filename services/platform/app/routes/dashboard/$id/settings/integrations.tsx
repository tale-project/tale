import { convexQuery } from '@convex-dev/react-query';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

import { AccessDenied } from '@/app/components/layout/access-denied';
import { Skeleton } from '@/app/components/ui/feedback/skeleton';
import { Card, CardContent, CardFooter } from '@/app/components/ui/layout/card';
import { Stack, Grid, HStack } from '@/app/components/ui/layout/layout';
import { IntegrationsClient } from '@/app/features/settings/integrations/components/integrations-client';
import { useSsoProvider } from '@/app/features/settings/integrations/hooks/queries';
import { useCurrentMemberContext } from '@/app/hooks/use-current-member-context';
import { api } from '@/convex/_generated/api';
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
      </CardContent>
      <CardFooter className="border-border border-t px-5 py-4">
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
  const { t } = useT('accessDenied');

  const { data: memberContext, isLoading: isMemberLoading } =
    useCurrentMemberContext(organizationId);
  const { data: integrations, isLoading: isIntegrationsLoading } = useQuery(
    convexQuery(api.integrations.queries.list, {
      organizationId,
    }),
  );
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
      integrations={integrations ?? []}
      ssoProvider={ssoProvider ?? null}
    />
  );
}
