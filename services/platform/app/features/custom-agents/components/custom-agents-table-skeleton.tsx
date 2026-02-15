'use client';

import { DataTableSkeleton } from '@/app/components/ui/data-table/data-table-skeleton';
import { useT } from '@/lib/i18n/client';

import { CustomAgentsActionMenu } from './custom-agents-action-menu';

interface CustomAgentsTableSkeletonProps {
  organizationId: string;
  rows?: number;
}

export function CustomAgentsTableSkeleton({
  organizationId,
  rows,
}: CustomAgentsTableSkeletonProps) {
  const { t } = useT('settings');
  const { t: tTables } = useT('tables');

  return (
    <DataTableSkeleton
      rows={rows}
      className="px-4 py-6"
      columns={[
        { header: t('customAgents.columns.displayName'), size: 250 },
        { header: tTables('headers.status'), size: 140 },
        { header: t('customAgents.columns.active'), size: 80 },
        { header: t('customAgents.columns.modelPreset'), size: 200 },
        { header: t('customAgents.columns.tools'), size: 100 },
        { header: t('customAgents.columns.team'), size: 140 },
        { isAction: true, size: 80 },
      ]}
      noFirstColumnAvatar
      searchPlaceholder={t('customAgents.searchAgent')}
      actionMenu={<CustomAgentsActionMenu organizationId={organizationId} />}
      infiniteScroll
    />
  );
}
