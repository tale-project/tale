'use client';

import type { UsePaginatedQueryResult } from 'convex/react';

import { useNavigate } from '@tanstack/react-router';
import { Store } from 'lucide-react';
import { useCallback, useMemo } from 'react';

import type { Doc } from '@/convex/_generated/dataModel';

import { DataTable } from '@/app/components/ui/data-table/data-table';
import { useListPage } from '@/app/hooks/use-list-page';
import { useT } from '@/lib/i18n/client';

import { useApproxVendorCount } from '../hooks/queries';
import { useVendorsTableConfig } from '../hooks/use-vendors-table-config';
import { VendorsActionMenu } from './vendors-action-menu';

type Vendor = Doc<'vendors'>;

export interface VendorsTableProps {
  organizationId: string;
  paginatedResult: UsePaginatedQueryResult<Vendor>;
  source?: string;
  locale?: string;
}

export function VendorsTable({
  organizationId,
  paginatedResult,
  source,
  locale,
}: VendorsTableProps) {
  const navigate = useNavigate();
  const { t: tVendors } = useT('vendors');
  const { t: tTables } = useT('tables');
  const { t: tGlobal } = useT('global');

  const { data: count } = useApproxVendorCount(organizationId);
  const { columns, searchPlaceholder, stickyLayout, pageSize } =
    useVendorsTableConfig();

  const handleSourceChange = useCallback(
    (values: string[]) => {
      void navigate({
        to: '/dashboard/$id/vendors',
        params: { id: organizationId },
        search: (prev) => ({
          ...prev,
          source: values[0] || undefined,
        }),
      });
    },
    [navigate, organizationId],
  );

  const handleLocaleChange = useCallback(
    (values: string[]) => {
      void navigate({
        to: '/dashboard/$id/vendors',
        params: { id: organizationId },
        search: (prev) => ({
          ...prev,
          locale: values[0] || undefined,
        }),
      });
    },
    [navigate, organizationId],
  );

  const handleClearFilters = useCallback(() => {
    void navigate({
      to: '/dashboard/$id/vendors',
      params: { id: organizationId },
      search: {},
    });
  }, [navigate, organizationId]);

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
        selectedValues: source ? [source] : [],
        onChange: handleSourceChange,
      },
      {
        key: 'locale',
        title: tTables('headers.locale'),
        grid: true,
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
        selectedValues: locale ? [locale] : [],
        onChange: handleLocaleChange,
      },
    ],
    [
      source,
      locale,
      tTables,
      tVendors,
      tGlobal,
      handleSourceChange,
      handleLocaleChange,
    ],
  );

  const list = useListPage<Vendor>({
    dataSource: {
      type: 'paginated',
      results: paginatedResult.results,
      status: paginatedResult.status,
      loadMore: paginatedResult.loadMore,
      isLoading: paginatedResult.isLoading,
    },
    pageSize,
    search: {
      fields: ['name', 'email', 'externalId'],
      placeholder: searchPlaceholder,
    },
    filters: {
      configs: filterConfigs,
      onClear: handleClearFilters,
    },
    skeletonRows: Math.min(count ?? 10, 10),
  });

  return (
    <DataTable
      columns={columns}
      stickyLayout={stickyLayout}
      actionMenu={<VendorsActionMenu organizationId={organizationId} />}
      emptyState={{
        icon: Store,
        title: tVendors('noVendorsYet'),
        description: tVendors('uploadFirstVendor'),
      }}
      {...list.tableProps}
    />
  );
}
