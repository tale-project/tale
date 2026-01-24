'use client';

import { useMemo, useState } from 'react';
import { usePaginatedQuery } from 'convex/react';
import { Users } from 'lucide-react';
import { api } from '@/convex/_generated/api';
import { DataTable } from '@/app/components/ui/data-table/data-table';
import { CustomersActionMenu } from './customers-action-menu';
import { useCustomersTableConfig } from '../hooks/use-customers-table-config';
import { useT } from '@/lib/i18n/client';
import {
  filterByTextSearch,
  filterByFields,
} from '@/lib/utils/client-utils';

export interface CustomersTableProps {
  organizationId: string;
}

export function CustomersTable({ organizationId }: CustomersTableProps) {
  const { t: tTables } = useT('tables');
  const { t: tEmpty } = useT('emptyStates');
  const { t: tCustomers } = useT('customers');
  const { t: tGlobal } = useT('global');

  const { columns, searchPlaceholder, stickyLayout, pageSize } =
    useCustomersTableConfig();

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [sourceFilter, setSourceFilter] = useState<string[]>([]);
  const [localeFilter, setLocaleFilter] = useState<string[]>([]);
  const [displayCount, setDisplayCount] = useState(pageSize);

  const { results, status, loadMore, isLoading } = usePaginatedQuery(
    api.customers.queries.listCustomers,
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
    if (statusFilter.length > 0) {
      activeFilters.push({ field: 'status', values: new Set(statusFilter) });
    }
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
  }, [results, search, statusFilter, sourceFilter, localeFilter]);

  const displayedCustomers = useMemo(
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
        key: 'status',
        title: tTables('headers.status'),
        options: [
          { value: 'active', label: tCustomers('filter.status.active') },
          { value: 'potential', label: tCustomers('filter.status.potential') },
          { value: 'churned', label: tCustomers('filter.status.churned') },
          { value: 'lost', label: tCustomers('filter.status.lost') },
        ],
        selectedValues: statusFilter,
        onChange: (values: string[]) => {
          setStatusFilter(values);
          setDisplayCount(pageSize);
        },
      },
      {
        key: 'source',
        title: tTables('headers.source'),
        options: [
          { value: 'manual_import', label: tCustomers('filter.source.manual') },
          { value: 'file_upload', label: tCustomers('filter.source.upload') },
          { value: 'circuly', label: tCustomers('filter.source.circuly') },
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
    [statusFilter, sourceFilter, localeFilter, pageSize, tTables, tCustomers, tGlobal],
  );

  const clearAll = () => {
    setSearch('');
    setStatusFilter([]);
    setSourceFilter([]);
    setLocaleFilter([]);
    setDisplayCount(pageSize);
  };

  return (
    <DataTable
      columns={columns}
      data={displayedCustomers}
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
      actionMenu={<CustomersActionMenu organizationId={organizationId} />}
      emptyState={{
        icon: Users,
        title: tEmpty('customers.title'),
        description: tEmpty('customers.description'),
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
