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
import { useCursorPaginatedQuery } from '@/hooks/use-cursor-paginated-query';
import { automationFilterDefinitions } from '../filter-definitions';

interface AutomationsTableProps {
  organizationId: string;
  preloadedAutomations: Preloaded<typeof api.wf_definitions.getAutomations>;
}

export function AutomationsTable({
  organizationId,
  preloadedAutomations,
}: AutomationsTableProps) {
  const router = useRouter();
  const { t: tTables } = useT('tables');
  const { t: tCommon } = useT('common');
  const { t: tEmpty } = useT('emptyStates');

  // Use shared table config
  const { columns, searchPlaceholder, stickyLayout, pageSize } = useAutomationsTableConfig();

  // Use unified URL filters hook (no pagination/sorting needed for cursor-based)
  const {
    filters: filterValues,
    setFilter,
    clearAll,
    isPending,
  } = useUrlFilters({
    filters: automationFilterDefinitions,
  });

  // Build query args for cursor-based pagination
  const queryArgs = useMemo(
    () => ({
      organizationId,
      searchTerm: filterValues.query || undefined,
      status: filterValues.status.length > 0 ? filterValues.status : undefined,
    }),
    [organizationId, filterValues],
  );

  // Use cursor-based paginated query with SSR + real-time updates
  const { data: automations, error, isLoadingMore, hasMore, loadMore, refetch } = useCursorPaginatedQuery({
    query: api.wf_definitions.getAutomations,
    preloadedData: preloadedAutomations,
    args: queryArgs,
    numItems: pageSize,
    // Transform args to wrap cursor/numItems into paginationOpts format
    transformArgs: (baseArgs, cursor, numItems) => ({
      ...baseArgs,
      paginationOpts: { cursor, numItems },
    }),
  });

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
      error={error}
      onRetry={refetch}
      getRowId={(row) => row._id}
      onRowClick={handleRowClick}
      stickyLayout={stickyLayout}
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
      infiniteScroll={{
        hasMore,
        onLoadMore: loadMore,
        isLoadingMore,
      }}
    />
  );
}
