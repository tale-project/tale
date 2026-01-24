'use client';

import { useMemo, useState } from 'react';
import { usePaginatedQuery } from 'convex/react';
import { Store } from 'lucide-react';
import { api } from '@/convex/_generated/api';
import { DataTable } from '@/app/components/ui/data-table/data-table';
import { VendorsActionMenu } from './vendors-action-menu';
import { useVendorsTableConfig } from '../hooks/use-vendors-table-config';
import { useT } from '@/lib/i18n/client';
import {
  filterByTextSearch,
  filterByFields,
} from '@/lib/utils/client-utils';

export interface VendorsTableProps {
  organizationId: string;
}

export function VendorsTable({ organizationId }: VendorsTableProps) {
  const { t: tVendors } = useT('vendors');
  const { t: tTables } = useT('tables');
  const { t: tGlobal } = useT('global');

  const { columns, searchPlaceholder, stickyLayout, pageSize } =
    useVendorsTableConfig();

  const [search, setSearch] = useState('');
  const [sourceFilter, setSourceFilter] = useState<string[]>([]);
  const [localeFilter, setLocaleFilter] = useState<string[]>([]);
  const [displayCount, setDisplayCount] = useState(pageSize);

  const { results, status, loadMore, isLoading } = usePaginatedQuery(
    api.vendors.queries.listVendors,
    { organizationId },
    { initialNumItems: pageSize },
  );

  const processed = useMemo(() => {
    if (!results) return [];

    let data = [...results];

    if (search) {
      data = filterByTextSearch(data, search, ['name', 'email', 'externalId']);
    }

    const activeFilters: Array<{ field: keyof (typeof data)[0]; values: Set<string> }> = [];
    if (sourceFilter.length > 0) {
      activeFilters.push({ field: 'source', values: new Set(sourceFilter) });
    }
    if (localeFilter.length > 0) {
      activeFilters.push({ field: 'locale', values: new Set(localeFilter) });
    }

    if (activeFilters.length > 0) {
      data = filterByFields(data, activeFilters);
    }

    return data;
  }, [results, search, sourceFilter, localeFilter]);

  const displayedVendors = useMemo(
    () => processed.slice(0, displayCount),
    [processed, displayCount],
  );

  const hasMore =
    displayCount < processed.length ||
    status === 'CanLoadMore' ||
    status === 'LoadingMore';

  const handleLoadMore = () => {
    if (displayCount >= processed.length && status === 'CanLoadMore') {
      loadMore(pageSize);
    }
    setDisplayCount((prev) => prev + pageSize);
  };

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
        selectedValues: sourceFilter,
        onChange: (values: string[]) => {
          setSourceFilter(values);
          setDisplayCount(pageSize);
        },
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
        selectedValues: localeFilter,
        onChange: (values: string[]) => {
          setLocaleFilter(values);
          setDisplayCount(pageSize);
        },
        grid: true,
      },
    ],
    [sourceFilter, localeFilter, pageSize, tTables, tVendors, tGlobal],
  );

  const clearAll = () => {
    setSearch('');
    setSourceFilter([]);
    setLocaleFilter([]);
    setDisplayCount(pageSize);
  };

  return (
    <DataTable
      columns={columns}
      data={displayedVendors}
      getRowId={(row) => row._id}
      stickyLayout={stickyLayout}
      search={{
        value: search,
        onChange: (value) => {
          setSearch(value);
          setDisplayCount(pageSize);
        },
        placeholder: searchPlaceholder,
      }}
      filters={filterConfigs}
      onClearFilters={clearAll}
      actionMenu={<VendorsActionMenu organizationId={organizationId} />}
      emptyState={{
        icon: Store,
        title: tVendors('noVendorsYet'),
        description: tVendors('uploadFirstVendor'),
      }}
      infiniteScroll={{
        hasMore,
        onLoadMore: handleLoadMore,
        isLoadingMore: status === 'LoadingMore',
        isInitialLoading: status === 'LoadingFirstPage',
      }}
    />
  );
}
