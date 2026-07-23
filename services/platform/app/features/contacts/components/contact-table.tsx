'use client';

import { useNavigate } from '@tanstack/react-router';
import type { Row, RowSelectionState } from '@tanstack/react-table';
import { Users } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';

import { DataTable } from '@/app/components/ui/data-table/data-table';
import { BulkDeleteBar } from '@/app/components/ui/data-table/data-table-bulk-actions';
import { useListPage } from '@/app/hooks/use-list-page';
import type { Doc } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';
import type { SortingState } from '@/lib/pagination/types';

import { useDeleteContact } from '../hooks/mutations';
import {
  useApproxContactCount,
  useListContactsPaginated,
} from '../hooks/queries';
import { useContactsTableConfig } from '../hooks/use-contacts-table-config';
import { ContactInfoDialog } from './contact-info-dialog';
import { ContactsActionMenu } from './contacts-action-menu';

type Contact = Doc<'contacts'>;

export interface ContactsTableProps {
  organizationId: string;
  source?: string;
  locale?: string;
}

export function ContactsTable({
  organizationId,
  source,
  locale,
}: ContactsTableProps) {
  const navigate = useNavigate();
  const { t: tTables } = useT('tables');
  const { t: tEmpty } = useT('emptyStates');
  const { t: tContacts } = useT('contacts');
  const { t: tGlobal } = useT('global');

  const { data: count } = useApproxContactCount(organizationId);
  const { columns, searchPlaceholder, stickyLayout, pageSize } =
    useContactsTableConfig();
  const paginatedResult = useListContactsPaginated({
    organizationId,
    source,
    locale,
    initialNumItems: pageSize,
  });

  const handleSourceChange = useCallback(
    (values: string[]) => {
      void navigate({
        to: '/dashboard/$id/contacts',
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
        to: '/dashboard/$id/contacts',
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
      to: '/dashboard/$id/contacts',
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
          { value: 'manual_import', label: tContacts('filter.source.manual') },
          { value: 'file_upload', label: tContacts('filter.source.upload') },
        ],
        selectedValues: source ? [source] : [],
        onChange: handleSourceChange,
      },
      {
        key: 'locale',
        title: tTables('headers.locale'),
        columns: 2 as const,
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
      tContacts,
      tGlobal,
      handleSourceChange,
      handleLocaleChange,
    ],
  );

  const [viewingContact, setViewingContact] = useState<Contact | null>(null);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [createOpen, setCreateOpen] = useState(false);
  // Client-side sort over the eagerly-loaded page buffer (pagination mode
  // loads all backend pages up front — see useListPage) — Name/Email/Added
  // are sortable (#2639), everything else keeps its fixed column order.
  const [sorting, setSorting] = useState<SortingState>([]);
  const deleteContact = useDeleteContact();

  const handleRowClick = useCallback((row: Row<Contact>) => {
    setViewingContact(row.original);
  }, []);

  const handleClearSelection = useCallback(() => {
    setRowSelection({});
  }, []);

  const handleDeleteItem = useCallback(
    async (id: string) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Convex Id type from row selection key
      const contactId = id as Doc<'contacts'>['_id'];
      await deleteContact.mutateAsync({ contactId });
    },
    [deleteContact],
  );

  const list = useListPage<Contact>({
    dataSource: {
      type: 'paginated',
      results: paginatedResult.results,
      status: paginatedResult.status,
      loadMore: paginatedResult.loadMore,
      isLoading: paginatedResult.isLoading,
    },
    pageSize,
    displayMode: 'pagination',
    search: {
      fields: ['name', 'email', 'externalId'],
      placeholder: searchPlaceholder,
    },
    filters: {
      configs: filterConfigs,
      onClear: handleClearFilters,
    },
    approxRowCount: count,
    entityLabel: {
      one: tContacts('entityLabelOne'),
      other: tContacts('title').toLowerCase(),
    },
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
        sorting={{ initialSorting: sorting, onSortingChange: setSorting }}
        actionMenu={
          <ContactsActionMenu
            organizationId={organizationId}
            createOpen={createOpen}
            onCreateOpenChange={setCreateOpen}
          />
        }
        emptyState={{
          icon: Users,
          title: tEmpty('contacts.title'),
          description: tEmpty('contacts.description'),
          headingLevel: 2,
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

      {viewingContact && (
        <ContactInfoDialog
          contact={viewingContact}
          open={!!viewingContact}
          onOpenChange={(open) => {
            if (!open) setViewingContact(null);
          }}
        />
      )}
    </>
  );
}
