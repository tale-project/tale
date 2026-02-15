'use client';

import { DataTableSkeleton } from '@/app/components/ui/data-table/data-table-skeleton';

import { useTeamsTableConfig } from '../hooks/use-teams-table-config';
import { TeamsActionMenu } from './teams-action-menu';

interface TeamsTableSkeletonProps {
  organizationId: string;
  rows?: number;
}

export function TeamsTableSkeleton({
  organizationId,
  rows,
}: TeamsTableSkeletonProps) {
  const { columns, searchPlaceholder, stickyLayout, infiniteScroll } =
    useTeamsTableConfig(organizationId);

  return (
    <DataTableSkeleton
      rows={rows}
      columns={columns}
      stickyLayout={stickyLayout}
      searchPlaceholder={searchPlaceholder}
      actionMenu={<TeamsActionMenu organizationId={organizationId} />}
      infiniteScroll={infiniteScroll}
    />
  );
}
