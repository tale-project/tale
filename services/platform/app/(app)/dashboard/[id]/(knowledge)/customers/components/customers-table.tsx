'use client';

import { useMemo } from 'react';
import { type Preloaded } from 'convex/react';
import { Users } from 'lucide-react';
import { api } from '@/convex/_generated/api';
import {
  DataTable,
  useDataTable,
} from '@/components/ui/data-table';
import { CustomersActionMenu } from './customers-action-menu';
import { useCustomersTableConfig } from '../hooks/use-customers-table-config';
import { useT } from '@/lib/i18n';
import { useUrlFilters } from '@/hooks/use-url-filters';
import { useCursorPaginatedQuery } from '@/hooks/use-cursor-paginated-query';
import { customerFilterDefinitions } from '../filter-definitions';

export interface CustomersTableProps {
  organizationId: string;
  preloadedCustomers: Preloaded<typeof api.customers.getCustomers>;
}

export function CustomersTable({
  organizationId,
  preloadedCustomers,
}: CustomersTableProps) {
  const { t: tTables } = useT('tables');
  const { t: tEmpty } = useT('emptyStates');
  const { t: tCustomers } = useT('customers');
  const { t: tGlobal } = useT('global');

  // Use shared table config
  const { columns, searchPlaceholder, stickyLayout, pageSize } = useCustomersTableConfig();

  // Use unified URL filters hook (no pagination/sorting needed for cursor-based)
  const urlFilters = useUrlFilters({
    filters: customerFilterDefinitions,
  });

  const { filters: filterValues } = urlFilters;

  // Use the useDataTable hook for search config
  const { searchConfig, clearAll, isPending } = useDataTable({
    urlFilters,
    search: { placeholder: searchPlaceholder },
  });

  // Build filter configs with proper translations
  const filterConfigs = useMemo(
    () => [
      {
        key: 'status',
        title: tTables('headers.status'),
        options: [
          { value: 'active', label: tCustomers('filter.status.active') },
          { value: 'potential', label: tCustomers('filter.status.potential') },
          { value: 'churned', label: tCustomers('filter.status.churned') },
          { value: 'lost', label: tCustomers('filter.status.lost') },
        ],
        selectedValues: filterValues.status,
        onChange: (values: string[]) => urlFilters.setFilter('status', values),
      },
      {
        key: 'source',
        title: tTables('headers.source'),
        options: [
          { value: 'manual_import', label: tCustomers('filter.source.manual') },
          { value: 'file_upload', label: tCustomers('filter.source.upload') },
          { value: 'circuly', label: tCustomers('filter.source.circuly') },
        ],
        selectedValues: filterValues.source,
        onChange: (values: string[]) => urlFilters.setFilter('source', values),
      },
      {
        key: 'locale',
        title: tTables('headers.locale'),
        options: [
          { value: 'en', label: tGlobal('languageCodes.en') },
          { value: 'es', label: tGlobal('languageCodes.es') },
          { value: 'fr', label: tGlobal('languageCodes.fr') },
          { value: 'de', label: tGlobal('languageCodes.de') },
          { value: 'it', label: tGlobal('languageCodes.it') },
          { value: 'pt', label: tGlobal('languageCodes.pt') },
          { value: 'nl', label: tGlobal('languageCodes.nl') },
          { value: 'zh', label: tGlobal('languageCodes.zh') },
        ],
        selectedValues: filterValues.locale,
        onChange: (values: string[]) => urlFilters.setFilter('locale', values),
        grid: true,
      },
    ],
    [filterValues, urlFilters, tTables, tCustomers, tGlobal],
  );

  // Build query args for cursor-based pagination
  // Note: api.customers.getCustomers expects paginationOpts: { numItems, cursor }
  // We pass a transformArgs function to wrap cursor/numItems into paginationOpts
  const queryArgs = useMemo(
    () => ({
      organizationId,
      searchTerm: filterValues.query || undefined,
      status: filterValues.status.length > 0
        ? (filterValues.status as Array<'active' | 'churned' | 'potential'>)
        : undefined,
      source: filterValues.source.length > 0 ? filterValues.source : undefined,
      locale: filterValues.locale.length > 0 ? filterValues.locale : undefined,
      // paginationOpts will be set by the hook using transformArgs
    }),
    [organizationId, filterValues],
  );

  // Use cursor-based paginated query with SSR + real-time updates
  const { data: customers, isLoadingMore, hasMore, loadMore } = useCursorPaginatedQuery({
    query: api.customers.getCustomers,
    preloadedData: preloadedCustomers,
    args: queryArgs,
    numItems: pageSize,
    // Transform args to wrap cursor/numItems into paginationOpts format
    transformArgs: (baseArgs, cursor, numItems) => ({
      ...baseArgs,
      paginationOpts: { cursor, numItems },
    }),
  });

  return (
    <DataTable
      columns={columns}
      data={customers}
      getRowId={(row) => row._id}
      stickyLayout={stickyLayout}
      search={searchConfig}
      filters={filterConfigs}
      isFiltersLoading={isPending}
      onClearFilters={clearAll}
      actionMenu={<CustomersActionMenu organizationId={organizationId} />}
      emptyState={{
        icon: Users,
        title: tEmpty('customers.title'),
        description: tEmpty('customers.description'),
      }}
      infiniteScroll={{
        hasMore,
        onLoadMore: loadMore,
        isLoadingMore,
      }}
    />
  );
}
