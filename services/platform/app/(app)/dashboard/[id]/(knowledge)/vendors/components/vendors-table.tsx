'use client';

import { useMemo } from 'react';
import { type Preloaded } from 'convex/react';
import { Store } from 'lucide-react';
import { api } from '@/convex/_generated/api';
import { DataTable } from '@/components/ui/data-table';
import { VendorsActionMenu } from './vendors-action-menu';
import { useVendorsTableConfig } from '../hooks/use-vendors-table-config';
import { useT } from '@/lib/i18n';
import { useUrlFilters } from '@/hooks/use-url-filters';
import { useCursorPaginatedQuery } from '@/hooks/use-cursor-paginated-query';
import { vendorFilterDefinitions } from '../filter-definitions';

export interface VendorsTableProps {
  organizationId: string;
  preloadedVendors: Preloaded<typeof api.vendors.getVendors>;
}

export function VendorsTable({
  organizationId,
  preloadedVendors,
}: VendorsTableProps) {
  const { t: tVendors } = useT('vendors');
  const { t: tTables } = useT('tables');
  const { t: tGlobal } = useT('global');

  // Use shared table config
  const { columns, searchPlaceholder, stickyLayout, pageSize } = useVendorsTableConfig();

  // Use unified URL filters hook (no pagination/sorting needed for cursor-based)
  const {
    filters: filterValues,
    setFilter,
    clearAll,
    isPending,
  } = useUrlFilters({
    filters: vendorFilterDefinitions,
  });

  // Build query args for cursor-based pagination
  const queryArgs = useMemo(
    () => ({
      organizationId,
      searchTerm: filterValues.query || undefined,
      source: filterValues.source.length > 0 ? filterValues.source : undefined,
      locale: filterValues.locale.length > 0 ? filterValues.locale : undefined,
    }),
    [organizationId, filterValues],
  );

  // Use cursor-based paginated query with SSR + real-time updates
  const { data: vendors, isLoadingMore, hasMore, loadMore } = useCursorPaginatedQuery({
    query: api.vendors.getVendors,
    preloadedData: preloadedVendors,
    args: queryArgs,
    numItems: pageSize,
    // Transform args to wrap cursor/numItems into paginationOpts format
    transformArgs: (baseArgs, cursor, numItems) => ({
      ...baseArgs,
      paginationOpts: { cursor, numItems },
    }),
  });

  // Build filter configs for DataTableFilters component
  const filterConfigs = useMemo(
    () => [
      {
        key: 'source',
        title: tTables('headers.source'),
        options: [
          { value: 'manual_import', label: tVendors('filter.source.manual') },
          { value: 'file_upload', label: tVendors('filter.source.upload') },
          { value: 'circuly', label: tVendors('filter.source.circuly') },
        ],
        selectedValues: filterValues.source,
        onChange: (values: string[]) => setFilter('source', values),
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
        onChange: (values: string[]) => setFilter('locale', values),
        grid: true,
      },
    ],
    [filterValues, setFilter, tTables, tVendors, tGlobal],
  );

  return (
    <DataTable
      columns={columns}
      data={vendors}
      getRowId={(row) => row._id}
      stickyLayout={stickyLayout}
      search={{
        value: filterValues.query,
        onChange: (value) => setFilter('query', value),
        placeholder: searchPlaceholder,
      }}
      filters={filterConfigs}
      isFiltersLoading={isPending}
      onClearFilters={clearAll}
      actionMenu={<VendorsActionMenu organizationId={organizationId} />}
      emptyState={{
        icon: Store,
        title: tVendors('noVendorsYet'),
        description: tVendors('uploadFirstVendor'),
      }}
      infiniteScroll={{
        hasMore,
        onLoadMore: loadMore,
        isLoadingMore,
      }}
    />
  );
}
