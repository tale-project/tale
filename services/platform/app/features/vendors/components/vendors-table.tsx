'use client';

import { useMemo, useState } from 'react';
import { Store } from 'lucide-react';
import { DataTable } from '@/app/components/ui/data-table/data-table';
import { VendorsActionMenu } from './vendors-action-menu';
import { useVendorsTableConfig } from '../hooks/use-vendors-table-config';
import { useT } from '@/lib/i18n/client';
import { useVendorsData } from '@/app/hooks/use-vendors-data';

export interface VendorsTableProps {
  organizationId: string;
}

export function VendorsTable({ organizationId }: VendorsTableProps) {
  const { t: tVendors } = useT('vendors');
  const { t: tTables } = useT('tables');
  const { t: tGlobal } = useT('global');

  const { columns, searchPlaceholder, stickyLayout, pageSize, defaultSort, defaultSortDesc } =
    useVendorsTableConfig();

  const [search, setSearch] = useState('');
  const [sourceFilter, setSourceFilter] = useState<string[]>([]);
  const [localeFilter, setLocaleFilter] = useState<string[]>([]);
  const [displayCount, setDisplayCount] = useState(pageSize);

  const { data: vendors, filteredCount } = useVendorsData({
    organizationId,
    search: search || undefined,
    source: sourceFilter.length > 0 ? sourceFilter : [],
    locale: localeFilter.length > 0 ? localeFilter : [],
    sortBy: defaultSort as 'name' | 'email' | '_creationTime',
    sortOrder: defaultSortDesc ? 'desc' : 'asc',
  });

  const displayedVendors = useMemo(
    () => vendors.slice(0, displayCount),
    [vendors, displayCount],
  );

  const hasMore = displayCount < filteredCount;

  const loadMore = () => {
    setDisplayCount((prev) => Math.min(prev + pageSize, filteredCount));
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
        onLoadMore: loadMore,
        isLoadingMore: false,
      }}
    />
  );
}
