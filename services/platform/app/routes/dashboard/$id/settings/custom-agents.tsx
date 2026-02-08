import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { CustomAgentsSettings } from '@/app/features/custom-agents/components/custom-agents-settings';
import { AccessDenied } from '@/app/components/layout/access-denied';
import { Skeleton } from '@/app/components/ui/feedback/skeleton';
import { Stack, HStack } from '@/app/components/ui/layout/layout';
import { DataTableSkeleton } from '@/app/components/ui/data-table/data-table-skeleton';
import { useT } from '@/lib/i18n/client';

export const Route = createFileRoute('/dashboard/$id/settings/custom-agents')({
  component: CustomAgentsSettingsPage,
});

function CustomAgentsSettingsSkeleton() {
  const { t } = useT('settings');

  return (
    <Stack>
      <Stack gap={1}>
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-4 w-80" />
      </Stack>

      <HStack justify="between" className="pt-4">
        <Skeleton className="h-9 w-full max-w-sm" />
        <Skeleton className="h-9 w-32" />
      </HStack>

      <DataTableSkeleton
        rows={5}
        columns={[
          { header: t('customAgents.columns.displayName'), size: 250 },
          { header: t('customAgents.columns.modelPreset'), size: 120 },
          { header: t('customAgents.columns.tools'), size: 100 },
          { header: t('customAgents.columns.version'), size: 80 },
          { isAction: true, size: 80 },
        ]}
        showHeader
      />
    </Stack>
  );
}

function CustomAgentsSettingsPage() {
  const { id: organizationId } = Route.useParams();
  const { t } = useT('accessDenied');

  const memberContext = useQuery(api.members.queries.getCurrentMemberContext, {
    organizationId,
  });

  if (memberContext === undefined || memberContext === null) {
    return <CustomAgentsSettingsSkeleton />;
  }

  if (!memberContext.isAdmin && memberContext.role !== 'developer') {
    return <AccessDenied message={t('customAgents')} />;
  }

  return <CustomAgentsSettings organizationId={organizationId} />;
}
