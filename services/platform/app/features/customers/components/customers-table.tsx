'use client';

import type { Row, RowSelectionState } from '@tanstack/react-table';

import { useNavigate } from '@tanstack/react-router';
import { Users } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';

import type { Doc } from '@/convex/_generated/dataModel';

import { DataTable } from '@/app/components/ui/data-table/data-table';
import { BulkDeleteBar } from '@/app/components/ui/data-table/data-table-bulk-actions';
import { useListPage } from '@/app/hooks/use-list-page';
import { useT } from '@/lib/i18n/client';

import { useDeleteCustomer } from '../hooks/mutations';
import {
  useApproxCustomerCount,
  useListCustomersPaginated,
} from '../hooks/queries';
import { useCustomersTableConfig } from '../hooks/use-customers-table-config';
import { CustomerInfoDialog } from './customer-info-dialog';
import { CustomersActionMenu } from './customers-action-menu';

type Customer = Doc<'customers'>;

export interface CustomersTableProps {
  organizationId: string;
  status?: string;
  source?: string;
  locale?: string;
}

export function CustomersTable({
  organizationId,
  status,
  source,
  locale,
}: CustomersTableProps) {
  const navigate = useNavigate();
  const { t: tTables } = useT('tables');
  const { t: tEmpty } = useT('emptyStates');
  const { t: tCustomers } = useT('customers');
  const { t: tGlobal } = useT('global');

  const { data: count } = useApproxCustomerCount(organizationId);
  const { columns, searchPlaceholder, stickyLayout, pageSize } =
    useCustomersTableConfig();
  const paginatedResult = useListCustomersPaginated({
    organizationId,
    status,
    source,
    locale,
    initialNumItems: pageSize,
  });

  const handleStatusChange = useCallback(
    (values: string[]) => {
      void navigate({
        to: '/dashboard/$id/customers',
        params: { id: organizationId },
        search: (prev) => ({
          ...prev,
          status: values[0] || undefined,
        }),
      });
    },
    [navigate, organizationId],
  );

  const handleSourceChange = useCallback(
    (values: string[]) => {
      void navigate({
        to: '/dashboard/$id/customers',
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
        to: '/dashboard/$id/customers',
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
      to: '/dashboard/$id/customers',
      params: { id: organizationId },
      search: {},
    });
  }, [navigate, organizationId]);

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
        selectedValues: status ? [status] : [],
        onChange: handleStatusChange,
      },
      {
        key: 'source',
        title: tTables('headers.source'),
        options: [
          { value: 'manual_import', label: tCustomers('filter.source.manual') },
          { value: 'file_upload', label: tCustomers('filter.source.upload') },
          { value: 'circuly', label: tCustomers('filter.source.circuly') },
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
      status,
      source,
      locale,
      tTables,
      tCustomers,
      tGlobal,
      handleStatusChange,
      handleSourceChange,
      handleLocaleChange,
    ],
  );

  const [viewingCustomer, setViewingCustomer] = useState<Customer | null>(null);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const deleteCustomer = useDeleteCustomer();

  const handleRowClick = useCallback((row: Row<Customer>) => {
    setViewingCustomer(row.original);
  }, []);

  const handleClearSelection = useCallback(() => {
    setRowSelection({});
  }, []);

  const handleDeleteItem = useCallback(
    async (id: string) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Convex Id type from row selection key
      const customerId = id as Doc<'customers'>['_id'];
      await deleteCustomer.mutateAsync({ customerId });
    },
    [deleteCustomer],
  );

  const list = useListPage<Customer>({
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
    entityLabel: tCustomers('title').toLowerCase(),
  });

  return (
    <>
      <DataTable
        columns={columns}
        stickyLayout={stickyLayout}
        onRowClick={handleRowClick}
        enableRowSelection
        rowSelection={rowSelection}
        onRowSelectionChange={setRowSelection}
        actionMenu={<CustomersActionMenu organizationId={organizationId} />}
        emptyState={{
          icon: Users,
          title: tEmpty('customers.title'),
          description: tEmpty('customers.description'),
        }}
        footer={
          <BulkDeleteBar
            rowSelection={rowSelection}
            onClearSelection={handleClearSelection}
            onDeleteItem={handleDeleteItem}
            onDeleteComplete={handleClearSelection}
          />
        }
        {...list.tableProps}
      />

      {viewingCustomer && (
        <CustomerInfoDialog
          customer={viewingCustomer}
          open={!!viewingCustomer}
          onOpenChange={(open) => {
            if (!open) setViewingCustomer(null);
          }}
        />
      )}
    </>
  );
}
