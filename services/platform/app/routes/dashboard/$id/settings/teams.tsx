import { convexQuery } from '@convex-dev/react-query';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';

import { AccessDenied } from '@/app/components/layout/access-denied';
import { DataTableSkeleton } from '@/app/components/ui/data-table/data-table-skeleton';
import { Skeleton } from '@/app/components/ui/feedback/skeleton';
import { Stack, HStack } from '@/app/components/ui/layout/layout';
import { TeamsSettings } from '@/app/features/settings/teams/components/teams-settings';
import { api } from '@/convex/_generated/api';
import { useT } from '@/lib/i18n/client';

export const Route = createFileRoute('/dashboard/$id/settings/teams')({
  component: TeamsSettingsPage,
});

function TeamsSettingsSkeleton() {
  const { t } = useT('settings');

  return (
    <Stack>
      <Stack gap={1}>
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-4 w-64" />
      </Stack>

      <HStack justify="between" className="pt-4">
        <Skeleton className="h-9 w-full max-w-sm" />
        <Skeleton className="h-9 w-32" />
      </HStack>

      <DataTableSkeleton
        rows={5}
        columns={[
          { header: t('teams.columns.name'), size: 300 },
          { isAction: true, size: 80 },
        ]}
        showHeader
      />
    </Stack>
  );
}

function TeamsSettingsPage() {
  const { id: organizationId } = Route.useParams();
  const { t } = useT('accessDenied');

  const { data: memberContext, isLoading } = useQuery(
    convexQuery(api.members.queries.getCurrentMemberContext, {
      organizationId,
    }),
  );

  if (isLoading) {
    return <TeamsSettingsSkeleton />;
  }

  if (!memberContext || !memberContext.isAdmin) {
    return <AccessDenied message={t('teams')} />;
  }

  return <TeamsSettings organizationId={organizationId} />;
}
