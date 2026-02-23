import { convexQuery } from '@convex-dev/react-query';
import { createFileRoute } from '@tanstack/react-router';

import { AccessDenied } from '@/app/components/layout/access-denied';
import { DataTableSkeleton } from '@/app/components/ui/data-table/data-table-skeleton';
import { Skeleton } from '@/app/components/ui/feedback/skeleton';
import { HStack, Stack } from '@/app/components/ui/layout/layout';
import { useOrganization } from '@/app/features/organization/hooks/queries';
import { OrganizationSettings } from '@/app/features/settings/organization/components/organization-settings';
import { useAbility } from '@/app/hooks/use-ability';
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
      {/* Org name: label + input + save button */}
      <HStack gap={3} align="end" justify="between">
        <Stack gap={1} className="max-w-sm flex-1">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-9 w-full" />
        </Stack>
        <Skeleton className="h-9 w-28 shrink-0" />
      </HStack>

      {/* Org ID row */}
      <HStack gap={2} align="center">
        <Skeleton className="h-4 w-24 shrink-0" />
        <Skeleton className="h-4 w-48" />
      </HStack>

      {/* Members section */}
      <Stack gap={4} className="pt-4">
        <Stack gap={1}>
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-4 w-52" />
        </Stack>

        <HStack justify="between">
          <Skeleton className="h-8 max-w-sm flex-1" />
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

  const ability = useAbility();
  const { data: memberContext } = useCurrentMemberContext(organizationId);
  const { data: organization, isLoading: isOrgLoading } =
    useOrganization(organizationId);

  if (isOrgLoading || !memberContext) {
    return <OrganizationSettingsSkeleton />;
  }

  if (ability.cannot('read', 'orgSettings')) {
    return <AccessDenied message={t('organization')} />;
  }

  if (!organization) {
    return null;
  }

  return (
    <OrganizationSettings
      organization={organization}
      memberContext={memberContext}
    />
  );
}
