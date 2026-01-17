'use client';

import { useMemo, useState } from 'react';
import { Globe } from 'lucide-react';
import { DataTable } from '@/app/components/ui/data-table/data-table';
import { WebsitesActionMenu } from './websites-action-menu';
import { useWebsitesTableConfig } from '../hooks/use-websites-table-config';
import { useT } from '@/lib/i18n/client';
import { useWebsitesData } from '@/app/hooks/use-websites-data';

export interface WebsitesTableProps {
  organizationId: string;
}

export function WebsitesTable({ organizationId }: WebsitesTableProps) {
  const { t: tTables } = useT('tables');
  const { t: tEmpty } = useT('emptyStates');
  const { t: tWebsites } = useT('websites');

  const { columns, searchPlaceholder, stickyLayout, pageSize, defaultSort, defaultSortDesc } =
    useWebsitesTableConfig();

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [displayCount, setDisplayCount] = useState(pageSize);

  const { data: websites, filteredCount } = useWebsitesData({
    organizationId,
    search: search || undefined,
    status: statusFilter.length > 0 ? statusFilter : [],
    sortBy: defaultSort as 'domain' | 'title' | '_creationTime' | 'lastScannedAt',
    sortOrder: defaultSortDesc ? 'desc' : 'asc',
  });

  const displayedWebsites = useMemo(
    () => websites.slice(0, displayCount),
    [websites, displayCount],
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
          { value: 'active', label: tWebsites('filter.status.active') },
          { value: 'scanning', label: tWebsites('filter.status.scanning') },
          { value: 'error', label: tWebsites('filter.status.error') },
        ],
        selectedValues: statusFilter,
        onChange: (values: string[]) => {
          setStatusFilter(values);
          setDisplayCount(pageSize);
        },
      },
    ],
    [statusFilter, pageSize, tTables, tWebsites],
  );

  const clearAll = () => {
    setSearch('');
    setStatusFilter([]);
    setDisplayCount(pageSize);
  };

  return (
    <DataTable
      columns={columns}
      data={displayedWebsites}
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
      actionMenu={<WebsitesActionMenu organizationId={organizationId} />}
      emptyState={{
        icon: Globe,
        title: tEmpty('websites.title'),
        description: tEmpty('websites.description'),
      }}
      infiniteScroll={{
        hasMore,
        onLoadMore: loadMore,
        isLoadingMore: false,
      }}
    />
  );
}
