'use client';

import { useMemo, useState } from 'react';
import { Users } from 'lucide-react';
import { DataTable } from '@/app/components/ui/data-table/data-table';
import { CustomersActionMenu } from './customers-action-menu';
import { useCustomersTableConfig } from '../hooks/use-customers-table-config';
import { useT } from '@/lib/i18n/client';
import { useCustomersData } from '@/app/hooks/use-customers-data';

export interface CustomersTableProps {
  organizationId: string;
}

export function CustomersTable({ organizationId }: CustomersTableProps) {
  const { t: tTables } = useT('tables');
  const { t: tEmpty } = useT('emptyStates');
  const { t: tCustomers } = useT('customers');
  const { t: tGlobal } = useT('global');

  const { columns, searchPlaceholder, stickyLayout, pageSize, defaultSort, defaultSortDesc } =
    useCustomersTableConfig();

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [sourceFilter, setSourceFilter] = useState<string[]>([]);
  const [localeFilter, setLocaleFilter] = useState<string[]>([]);
  const [displayCount, setDisplayCount] = useState(pageSize);

  const { data: customers, filteredCount } = useCustomersData({
    organizationId,
    search: search || undefined,
    status: statusFilter.length > 0 ? statusFilter : [],
    source: sourceFilter.length > 0 ? sourceFilter : [],
    locale: localeFilter.length > 0 ? localeFilter : [],
    sortBy: defaultSort as 'name' | 'email' | '_creationTime' | 'status',
    sortOrder: defaultSortDesc ? 'desc' : 'asc',
  });

  const displayedCustomers = useMemo(
    () => customers.slice(0, displayCount),
    [customers, displayCount],
  );

  const hasMore = displayCount < filteredCount;

  const loadMore = () => {
    setDisplayCount((prev) => Math.min(prev + pageSize, filteredCount));
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
        onLoadMore: loadMore,
        isLoadingMore: false,
      }}
    />
  );
}
