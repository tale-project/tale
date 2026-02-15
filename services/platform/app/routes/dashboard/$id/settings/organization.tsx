import { convexQuery } from '@convex-dev/react-query';
import { createFileRoute } from '@tanstack/react-router';

import { AccessDenied } from '@/app/components/layout/access-denied';
import { DataTableSkeleton } from '@/app/components/ui/data-table/data-table-skeleton';
import { Skeleton } from '@/app/components/ui/feedback/skeleton';
import { Stack, HStack } from '@/app/components/ui/layout/layout';
import { useOrganization } from '@/app/features/organization/hooks/queries';
import { OrganizationSettingsClient } from '@/app/features/settings/organization/components/organization-settings-client';
import { useCurrentMemberContext } from '@/app/hooks/use-current-member-context';
import { api } from '@/convex/_generated/api';
import { useT } from '@/lib/i18n/client';
import { seo } from '@/lib/utils/seo';

export const Route = createFileRoute('/dashboard/$id/settings/organization')({
  head: () => ({
    meta: seo('organization'),
  }),
  loader: ({ context, params }) => {
    void context.queryClient.prefetchQuery(
      convexQuery(api.organizations.queries.getOrganization, {
        id: params.id,
      }),
    );
  },
  component: OrganizationSettingsPage,
});

function OrganizationSettingsSkeleton() {
  const { t: tTables } = useT('tables');

  return (
    <Stack>
      <Stack gap={2}>
        <Skeleton className="h-4 w-36" />
        <HStack gap={3} justify="between">
          <Skeleton className="h-9 max-w-sm flex-1" />
          <Skeleton className="h-9 w-28" />
        </HStack>
      </Stack>

      <Stack className="pt-4">
        <Stack gap={1}>
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-4 w-56" />
        </Stack>

        <HStack justify="between">
          <Skeleton className="h-9 w-full max-w-md" />
          <Skeleton className="h-9 w-32" />
        </HStack>

        <DataTableSkeleton
          rows={5}
          columns={[
            { header: tTables('headers.member'), size: 348 },
            { header: tTables('headers.role'), size: 200 },
            { header: tTables('headers.joined'), align: 'right' },
            { isAction: true, size: 140 },
          ]}
          showHeader
        />
      </Stack>
    </Stack>
  );
}

function OrganizationSettingsPage() {
  const { id: organizationId } = Route.useParams();
  const { t } = useT('accessDenied');

  const { data: memberContext, isLoading: isMemberLoading } =
    useCurrentMemberContext(organizationId);
  const { data: organization, isLoading: isOrgLoading } =
    useOrganization(organizationId);
  if (isMemberLoading || isOrgLoading || !memberContext) {
    return <OrganizationSettingsSkeleton />;
  }

  if (!memberContext.isAdmin) {
    return <AccessDenied message={t('organization')} />;
  }

  if (!organization) {
    return null;
  }

  return (
    <OrganizationSettingsClient
      organization={organization}
      memberContext={memberContext}
    />
  );
}
