'use client';

import { useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { type Preloaded } from 'convex/react';
import { Workflow } from 'lucide-react';
import { type ColumnDef, type Row } from '@tanstack/react-table';
import { api } from '@/convex/_generated/api';
import { Doc } from '@/convex/_generated/dataModel';
import { DataTable } from '@/components/ui/data-table';
import { HStack } from '@/components/ui/layout';
import { Badge } from '@/components/ui/badge';
import { TableTimestampCell } from '@/components/ui/table-date-cell';
import { AutomationsActionMenu } from './automations-action-menu';
import { AutomationRowActions } from './automation-row-actions';
import { useT } from '@/lib/i18n';
import { useUrlFilters } from '@/hooks/use-url-filters';
import { useOffsetPaginatedQuery } from '@/hooks/use-offset-paginated-query';
import { automationFilterDefinitions } from '../filter-definitions';

interface AutomationsTableProps {
  organizationId: string;
  preloadedAutomations: Preloaded<typeof api.wf_definitions.listAutomations>;
}

export function AutomationsTable({
  organizationId,
  preloadedAutomations,
}: AutomationsTableProps) {
  const router = useRouter();
  const { t: tAutomations } = useT('automations');
  const { t: tTables } = useT('tables');
  const { t: tCommon } = useT('common');
  const { t: tEmpty } = useT('emptyStates');

  // Use unified URL filters hook with sorting
  const {
    filters: filterValues,
    sorting,
    setSorting,
    pagination,
    setFilter,
    setPage,
    setPageSize,
    clearAll,
    hasActiveFilters,
    isPending,
  } = useUrlFilters({
    filters: automationFilterDefinitions,
    pagination: { defaultPageSize: 10 },
    sorting: { defaultSort: '_creationTime', defaultDesc: true },
  });

  // Use paginated query with SSR + real-time updates
  const { data, isLoading } = useOffsetPaginatedQuery({
    query: api.wf_definitions.listAutomations,
    preloadedData: preloadedAutomations,
    organizationId,
    filters: {
      filters: filterValues,
      sorting,
      pagination,
      setFilter,
      setSorting,
      setPage,
      setPageSize,
      clearAll,
      hasActiveFilters,
      isPending,
      definitions: automationFilterDefinitions,
    },
    transformFilters: (f) => ({
      searchTerm: f.query || undefined,
      status: f.status.length > 0 ? f.status : undefined,
      sortField: sorting[0]?.id,
      sortOrder: sorting[0] ? (sorting[0].desc ? 'desc' as const : 'asc' as const) : undefined,
    }),
  });

  const automations = data?.items ?? [];

  const handleRowClick = (row: Row<Doc<'wfDefinitions'>>) => {
    router.push(`/dashboard/${organizationId}/automations/${row.original._id}`);
  };

  // Helper function to get status badge color
  const getStatusBadge = useCallback(
    (status: string) => {
      return (
        <Badge dot variant={status === 'active' ? 'green' : 'outline'}>
          {status === 'active'
            ? tCommon('status.published')
            : tCommon('status.draft')}
        </Badge>
      );
    },
    [tCommon],
  );

  // Define columns using TanStack Table
  const columns = useMemo<ColumnDef<Doc<'wfDefinitions'>>[]>(
    () => [
      {
        accessorKey: 'name',
        header: tTables('headers.automation'),
        size: 328,
        cell: ({ row }) => (
          <span className="text-sm font-medium text-foreground truncate px-2">
            {row.original.name}
          </span>
        ),
      },
      {
        accessorKey: 'status',
        header: tTables('headers.status'),
        size: 140,
        cell: ({ row }) => getStatusBadge(row.original.status),
      },
      {
        accessorKey: 'version',
        header: tTables('headers.version'),
        size: 100,
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground">
            {row.original.version}
          </span>
        ),
      },
      {
        accessorKey: '_creationTime',
        header: () => (
          <span className="text-right w-full block">
            {tTables('headers.created')}
          </span>
        ),
        size: 140,
        cell: ({ row }) => (
          <TableTimestampCell timestamp={row.original._creationTime} preset="short" />
        ),
      },
      {
        id: 'actions',
        size: 80,
        cell: ({ row }) => (
          <HStack justify="end">
            <AutomationRowActions automation={row.original} />
          </HStack>
        ),
      },
    ],
    [getStatusBadge, tTables],
  );

  // Build filter configs for DataTableFilters component
  const filterConfigs = useMemo(
    () => [
      {
        key: 'status',
        title: tTables('headers.status'),
        options: [
          { value: 'active', label: tCommon('status.published') },
          { value: 'draft', label: tCommon('status.draft') },
        ],
        selectedValues: filterValues.status,
        onChange: (values: string[]) => setFilter('status', values),
      },
    ],
    [filterValues, setFilter, tTables, tCommon],
  );

  return (
    <DataTable
      columns={columns}
      data={automations}
      getRowId={(row) => row._id}
      onRowClick={handleRowClick}
      isLoading={isLoading}
      stickyLayout
      sorting={{
        initialSorting: sorting,
        onSortingChange: setSorting,
      }}
      search={{
        value: filterValues.query,
        onChange: (value) => setFilter('query', value),
        placeholder: tAutomations('searchPlaceholder'),
      }}
      filters={filterConfigs}
      isFiltersLoading={isPending}
      onClearFilters={clearAll}
      actionMenu={<AutomationsActionMenu organizationId={organizationId} />}
      emptyState={{
        icon: Workflow,
        title: tEmpty('automations.title'),
        description: tEmpty('automations.description'),
      }}
      pagination={{
        total: data?.total ?? 0,
        pageSize: pagination.pageSize,
        totalPages: data?.totalPages ?? 1,
        hasNextPage: data?.hasNextPage ?? false,
        hasPreviousPage: data?.hasPreviousPage ?? false,
        onPageChange: setPage,
        onPageSizeChange: setPageSize,
        clientSide: false,
      }}
      currentPage={pagination.page}
    />
  );
}
