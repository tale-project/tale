import { convexQuery } from '@convex-dev/react-query';
import { createFileRoute } from '@tanstack/react-router';

import { AccessDenied } from '@/app/components/layout/access-denied';
import { DataTableSkeleton } from '@/app/components/ui/data-table/data-table-skeleton';
import { Skeleton } from '@/app/components/ui/feedback/skeleton';
import { HStack, Stack } from '@/app/components/ui/layout/layout';
import { PageSection } from '@/app/components/ui/layout/page-section';
import { Separator } from '@/app/components/ui/layout/separator';
import { useOrganization } from '@/app/features/organization/hooks/queries';
import { OrganizationSettings } from '@/app/features/settings/organization/components/organization-settings';
import { useAbility, useAbilityLoading } from '@/app/hooks/use-ability';
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
    <Stack gap={6}>
      <PageSection
        title={<Skeleton className="h-5 w-40" />}
        description={<Skeleton className="h-4 w-64" />}
        gap={5}
      >
        <Separator />
        <HStack gap={3} align="end" justify="between">
          <Stack gap={1} className="max-w-sm flex-1">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-9 w-full" />
          </Stack>
          <Skeleton className="h-9 w-28 shrink-0" />
        </HStack>

        <Stack gap={1} className="max-w-sm">
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-9 w-full" />
        </Stack>

        <div className="max-w-sm space-y-2">
          <div className="flex flex-col gap-0.5">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-3 w-36" />
          </div>
          <div className="bg-muted/50 flex items-center gap-2 rounded-lg border px-4 py-3">
            <Skeleton className="h-4 flex-1" />
            <Skeleton className="size-4 shrink-0" />
          </div>
        </div>
      </PageSection>

      <PageSection
        title={<Skeleton className="h-5 w-24" />}
        description={<Skeleton className="h-4 w-52" />}
      >
        <Separator />
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
      </PageSection>
    </Stack>
  );
}

function OrganizationSettingsPage() {
  const { id: organizationId } = Route.useParams();
  const { t } = useT('accessDenied');

  const ability = useAbility();
  const abilityLoading = useAbilityLoading();
  const { data: memberContext } = useCurrentMemberContext(organizationId);
  const { data: organization, isLoading: isOrgLoading } =
    useOrganization(organizationId);

  if (abilityLoading || isOrgLoading || !memberContext) {
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
