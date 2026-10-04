'use client';

import { DataTable } from '@tale/ui/data-table/data-table';
import { BulkDeleteBar } from '@tale/ui/data-table/data-table-bulk-actions';
import { useDebounce } from '@tale/ui/use-debounce';
import { useListPage } from '@tale/ui/use-list-page';
import { useNavigate } from '@tanstack/react-router';
import type { Row, RowSelectionState } from '@tanstack/react-table';
import { Users } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';

import { useAbility } from '@/app/hooks/use-ability';
import { useViewedRecord } from '@/app/hooks/use-viewed-record';
import { firstFailureDetail } from '@/app/lib/backend/adapters';
import type { ContactDoc } from '@/app/lib/backend/contract/docs';
import { useT } from '@/lib/i18n/client';
import type { SortingState } from '@/lib/pagination/types';

import { useDeleteContact } from '../hooks/mutations';
import {
  useApproxContactCount,
  useListContactsPaginated,
} from '../hooks/queries';
import { useContactsTableConfig } from '../hooks/use-contacts-table-config';
import { canEditContact } from '../lib/contact-data';
import { ContactViewDialog } from './contact-view-dialog';
import { ContactsActionMenu } from './contacts-action-menu';

type Contact = ContactDoc;

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
  const ability = useAbility();
  const { t: tTables } = useT('tables');
  const { t: tEmpty } = useT('emptyStates');
  const { t: tContacts } = useT('contacts');
  const { t: tGlobal } = useT('global');

  const { data: count } = useApproxContactCount(organizationId);
  const { columns, searchPlaceholder, pageSize } = useContactsTableConfig();
  const [searchValue, setSearchValue] = useState('');
  const debouncedSearch = useDebounce(searchValue.trim(), 250);
  const paginatedResult = useListContactsPaginated({
    organizationId,
    search: debouncedSearch || undefined,
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
          { value: 'api_import', label: tContacts('filter.source.api') },
          {
            value: 'conversation',
            label: tContacts('filter.source.conversation'),
          },
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

  const {
    record: viewedRecord,
    open: openRecord,
    close: closeRecord,
  } = useViewedRecord(paginatedResult.results, paginatedResult.status);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [createOpen, setCreateOpen] = useState(false);
  // Name/Email/Added are sortable (#2639); everything else keeps its fixed
  // column order. The state rides into `useListPage` as well as the table so
  // the sort runs over every contact, not the page in view — see its
  // `sorting` option.
  const [sorting, setSorting] = useState<SortingState>([]);
  const deleteContact = useDeleteContact();

  const handleRowClick = useCallback(
    (row: Row<Contact>) => {
      openRecord(row.original._id);
    },
    [openRecord],
  );

  const handleClearSelection = useCallback(() => {
    setRowSelection({});
  }, []);

  // Only a contact whose row menu offers Delete gets a checkbox: a synced
  // contact belongs to its source, and a member who cannot write deletes
  // nothing (#3623).
  const canSelectRow = useCallback(
    (row: Row<Contact>) => canEditContact(ability, row.original),
    [ability],
  );

  // The bar deletes every id it is handed. A contact selected before a sync
  // took it over (or before this member lost write access) keeps its id in the
  // selection once its checkbox is gone, so the table and the bar get the
  // selection without it. An id no longer loaded stays, as before: it passed
  // the rule when it was picked, and dropping it would shrink the count while a
  // delete's own refetch removes rows.
  const deletableSelection = useMemo(() => {
    if (Object.keys(rowSelection).length === 0) return rowSelection;
    const loaded = new Map(
      paginatedResult.results.map((contact) => [contact._id, contact]),
    );
    return Object.fromEntries(
      Object.entries(rowSelection).filter(([id]) => {
        const contact = loaded.get(id);
        return contact === undefined || canEditContact(ability, contact);
      }),
    );
  }, [rowSelection, paginatedResult.results, ability]);

  const handleDeleteItem = useCallback(
    async (id: string) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Convex Id type from row selection key
      const contactId = id;
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
    sorting,
    sortingColumns: columns,
    search: {
      serverSide: true,
      value: searchValue,
      onChange: setSearchValue,
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
        stickyLayout
        onRowClick={handleRowClick}
        enableRowSelection={canSelectRow}
        rowSelection={deletableSelection}
        onRowSelectionChange={setRowSelection}
        sorting={{
          manual: true,
          initialSorting: sorting,
          onSortingChange: setSorting,
        }}
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
            rowSelection={deletableSelection}
            onClearSelection={handleClearSelection}
            onDeleteItem={handleDeleteItem}
            onDeleteComplete={handleClearSelection}
            describeFailure={firstFailureDetail}
          />
        }
        {...list.tableProps}
      />

      {viewedRecord && (
        <ContactViewDialog
          isOpen
          onClose={closeRecord}
          contact={viewedRecord}
        />
      )}
    </>
  );
}
