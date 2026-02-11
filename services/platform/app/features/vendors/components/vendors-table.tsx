'use client';

import { Store } from 'lucide-react';

import type { Vendor } from '@/lib/collections/entities/vendors';

import { DataTable } from '@/app/components/ui/data-table/data-table';
import { useListPage } from '@/app/hooks/use-list-page';
import { useT } from '@/lib/i18n/client';

import { useVendorsTableConfig } from '../hooks/use-vendors-table-config';
import { VendorsActionMenu } from './vendors-action-menu';

export interface VendorsTableProps {
  organizationId: string;
  vendors: Vendor[];
}

export function VendorsTable({ organizationId, vendors }: VendorsTableProps) {
  const { t: tVendors } = useT('vendors');
  const { t: tTables } = useT('tables');
  const { t: tGlobal } = useT('global');

  const { columns, searchPlaceholder, stickyLayout, pageSize } =
    useVendorsTableConfig();

  const list = useListPage({
    dataSource: { type: 'query', data: vendors },
    pageSize,
    search: {
      fields: ['name', 'email', 'externalId'],
      placeholder: searchPlaceholder,
    },
    filters: {
      definitions: [
        {
          key: 'source',
          title: tTables('headers.source'),
          options: [
            { value: 'manual_import', label: tVendors('filter.source.manual') },
            { value: 'file_upload', label: tVendors('filter.source.upload') },
            { value: 'circuly', label: tVendors('filter.source.circuly') },
          ],
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
          grid: true,
        },
      ],
    },
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
