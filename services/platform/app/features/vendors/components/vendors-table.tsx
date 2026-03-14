'use client';

import type { Row } from '@tanstack/react-table';

import { useNavigate } from '@tanstack/react-router';
import { Store } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';

import type { Doc } from '@/convex/_generated/dataModel';

import { DataTable } from '@/app/components/ui/data-table/data-table';
import { useListPage } from '@/app/hooks/use-list-page';
import { useT } from '@/lib/i18n/client';

import {
  useApproxVendorCount,
  useListVendorsPaginated,
} from '../hooks/queries';
import { useVendorsTableConfig } from '../hooks/use-vendors-table-config';
import { VendorInfoDialog } from './vendor-info-dialog';
import { VendorsActionMenu } from './vendors-action-menu';

type Vendor = Doc<'vendors'>;

export interface VendorsTableProps {
  organizationId: string;
  source?: string;
  locale?: string;
}

export function VendorsTable({
  organizationId,
  source,
  locale,
}: VendorsTableProps) {
  const navigate = useNavigate();
  const { t: tVendors } = useT('vendors');
  const { t: tEmpty } = useT('emptyStates');
  const { t: tTables } = useT('tables');
  const { t: tGlobal } = useT('global');

  const { data: count } = useApproxVendorCount(organizationId);
  const { columns, searchPlaceholder, stickyLayout, pageSize } =
    useVendorsTableConfig();
  const paginatedResult = useListVendorsPaginated({
    organizationId,
    source,
    locale,
    initialNumItems: pageSize,
  });

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

  const [viewingVendor, setViewingVendor] = useState<Vendor | null>(null);

  const handleRowClick = useCallback((row: Row<Vendor>) => {
    setViewingVendor(row.original);
  }, []);

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
    approxRowCount: count,
  });

  return (
    <>
      <DataTable
        columns={columns}
        stickyLayout={stickyLayout}
        onRowClick={handleRowClick}
        actionMenu={<VendorsActionMenu organizationId={organizationId} />}
        emptyState={{
          icon: Store,
          title: tEmpty('vendors.title'),
          description: tEmpty('vendors.description'),
        }}
        {...list.tableProps}
      />

      {viewingVendor && (
        <VendorInfoDialog
          vendor={viewingVendor}
          open={!!viewingVendor}
          onOpenChange={(open) => {
            if (!open) setViewingVendor(null);
          }}
        />
      )}
    </>
  );
}
