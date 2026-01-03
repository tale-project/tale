'use client';

import { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { type Preloaded } from 'convex/react';
import { Workflow } from 'lucide-react';
import { type Row } from '@tanstack/react-table';
import { api } from '@/convex/_generated/api';
import { Doc } from '@/convex/_generated/dataModel';
import { DataTable } from '@/components/ui/data-table';
import { AutomationsActionMenu } from './automations-action-menu';
import { useAutomationsTableConfig } from './use-automations-table-config';
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

  // Use shared table config
  const { columns, searchPlaceholder, stickyLayout, pageSize, defaultSort, defaultSortDesc } = useAutomationsTableConfig();

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
    pagination: { defaultPageSize: pageSize },
    sorting: { defaultSort, defaultDesc: defaultSortDesc },
  });

  // Use paginated query with SSR + real-time updates
  const { data } = useOffsetPaginatedQuery({
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
      sortOrder: sorting[0]
        ? sorting[0].desc
          ? ('desc' as const)
          : ('asc' as const)
        : undefined,
    }),
  });

  const automations = data?.items ?? [];

  const handleRowClick = (row: Row<Doc<'wfDefinitions'>>) => {
    router.push(`/dashboard/${organizationId}/automations/${row.original._id}?panel=ai-chat`);
  };

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
      className="py-6 px-4"
      columns={columns}
      data={automations}
      getRowId={(row) => row._id}
      onRowClick={handleRowClick}
      stickyLayout={stickyLayout}
      sorting={{
        initialSorting: sorting,
        onSortingChange: setSorting,
      }}
      search={{
        value: filterValues.query,
        onChange: (value) => setFilter('query', value),
        placeholder: searchPlaceholder,
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
