'use client';

import { DataTableSkeleton } from '@/app/components/ui/data-table/data-table-skeleton';

import { useApiKeysTableConfig } from '../hooks/use-api-keys-table-config';
import { ApiKeysActionMenu } from './api-keys-action-menu';

interface ApiKeysTableSkeletonProps {
  organizationId: string;
  rows?: number;
}

export function ApiKeysTableSkeleton({
  organizationId,
  rows,
}: ApiKeysTableSkeletonProps) {
  const { columns, searchPlaceholder, stickyLayout, infiniteScroll } =
    useApiKeysTableConfig(organizationId);

  return (
    <DataTableSkeleton
      rows={rows}
      columns={columns}
      stickyLayout={stickyLayout}
      searchPlaceholder={searchPlaceholder}
      actionMenu={<ApiKeysActionMenu organizationId={organizationId} />}
      infiniteScroll={infiniteScroll}
    />
  );
}
