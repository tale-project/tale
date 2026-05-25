'use client';

import { Skeleton } from '@tale/ui/skeleton';
import type { ColumnDef } from '@tanstack/react-table';

import { DataTableSkeleton } from '@/app/components/ui/data-table/data-table-skeleton';

import { useProvidersTableConfig } from '../hooks/use-providers-table-config';
import type { ProviderRow } from './providers-table';

/**
 * Loading state for the providers list — uses the real provider table
 * columns so widths line up exactly when the live data arrives. Replaces
 * the generic `SettingsListPageSkeleton` previously used by the providers
 * route.
 */
export function ProvidersPageSkeleton() {
  const { columns, searchPlaceholder, stickyLayout } =
    useProvidersTableConfig();

  const actionColumn: ColumnDef<ProviderRow> = {
    id: 'actions',
    size: 44,
    meta: { isAction: true },
  };

  return (
    <DataTableSkeleton
      columns={[...columns, actionColumn]}
      rows={5}
      searchPlaceholder={searchPlaceholder}
      stickyLayout={stickyLayout}
      noFirstColumnAvatar
      actionMenu={<Skeleton className="h-9 w-32 rounded-md" />}
    />
  );
}
