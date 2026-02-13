'use client';

import { DataTableSkeleton } from '@/app/components/ui/data-table/data-table-skeleton';
import { useT } from '@/lib/i18n/client';

import { CustomAgentsActionMenu } from './custom-agents-action-menu';

interface CustomAgentsTableSkeletonProps {
  organizationId: string;
}

export function CustomAgentsTableSkeleton({
  organizationId,
}: CustomAgentsTableSkeletonProps) {
  const { t } = useT('settings');

  return (
    <DataTableSkeleton
      className="px-4 py-6"
      columns={[
        { size: 250 },
        { size: 140 },
        { size: 80 },
        { size: 200 },
        { size: 100 },
        { size: 140 },
        { size: 80 },
      ]}
      noFirstColumnAvatar
      searchPlaceholder={t('customAgents.searchAgent')}
      actionMenu={<CustomAgentsActionMenu organizationId={organizationId} />}
      infiniteScroll
    />
  );
}
