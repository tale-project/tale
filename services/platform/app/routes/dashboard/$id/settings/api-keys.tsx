import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from 'convex/react';

import { AccessDenied } from '@/app/components/layout/access-denied';
import { DataTableSkeleton } from '@/app/components/ui/data-table/data-table-skeleton';
import { Skeleton } from '@/app/components/ui/feedback/skeleton';
import { Stack, HStack } from '@/app/components/ui/layout/layout';
import { ApiKeysSettings } from '@/app/features/settings/api-keys/components/api-keys-settings';
import { api } from '@/convex/_generated/api';
import { useT } from '@/lib/i18n/client';

export const Route = createFileRoute('/dashboard/$id/settings/api-keys')({
  component: ApiKeysSettingsPage,
});

function ApiKeysSettingsSkeleton() {
  const { t } = useT('settings');

  return (
    <Stack>
      <Stack gap={1}>
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-4 w-64" />
      </Stack>

      <HStack justify="end" className="pt-4">
        <Skeleton className="h-9 w-32" />
      </HStack>

      <DataTableSkeleton
        rows={3}
        columns={[
          { header: t('apiKeys.columns.name'), size: 200 },
          { header: t('apiKeys.columns.prefix'), size: 150 },
          { header: t('apiKeys.columns.created'), size: 150 },
          { header: t('apiKeys.columns.lastUsed'), size: 150 },
          { header: t('apiKeys.columns.expires'), size: 150 },
          { isAction: true, size: 80 },
        ]}
        showHeader
      />
    </Stack>
  );
}

function ApiKeysSettingsPage() {
  const { id: organizationId } = Route.useParams();
  const { t } = useT('accessDenied');

  const memberContext = useQuery(api.members.queries.getCurrentMemberContext, {
    organizationId,
  });

  if (memberContext === undefined) {
    return <ApiKeysSettingsSkeleton />;
  }

  if (memberContext === null) {
    return <AccessDenied message={t('apiKeys')} />;
  }

  const userRole = memberContext.role.toLowerCase();
  const hasAccess = userRole === 'admin' || userRole === 'developer';

  if (!hasAccess) {
    return <AccessDenied message={t('apiKeys')} />;
  }

  return <ApiKeysSettings organizationId={organizationId} />;
}
