'use client';

import { DataTable } from '@tale/ui/data-table/data-table';
import { BulkDeleteBar } from '@tale/ui/data-table/data-table-bulk-actions';
import type { Row, RowSelectionState } from '@tanstack/react-table';
import { BookOpen } from 'lucide-react';
import { useCallback, useState } from 'react';

import { useListPage } from '@/app/hooks/use-list-page';
import { useViewedRecord } from '@/app/hooks/use-viewed-record';
import { useT } from '@/lib/i18n/client';

import { useDeleteKnowledgeEntry } from '../hooks/mutations';
import {
  useApproxKnowledgeEntryCount,
  useListKnowledgeEntriesPaginated,
  type KnowledgeEntryItem,
} from '../hooks/queries';
import { useKnowledgeEntriesTableConfig } from '../hooks/use-knowledge-entries-table-config';
import { KnowledgeEntriesActionMenu } from './knowledge-entries-action-menu';
import { KnowledgeEntryViewDialog } from './knowledge-entry-view-dialog';

export interface KnowledgeEntriesTableProps {
  organizationId: string;
}

export function KnowledgeEntriesTable({
  organizationId,
}: KnowledgeEntriesTableProps) {
  const { t: tEmpty } = useT('emptyStates');
  const { t } = useT('knowledgeEntries');
  const [createOpen, setCreateOpen] = useState(false);

  const { data: count } = useApproxKnowledgeEntryCount(organizationId);
  const { columns, searchPlaceholder, stickyLayout, pageSize } =
    useKnowledgeEntriesTableConfig();
  const paginatedResult = useListKnowledgeEntriesPaginated({
    organizationId,
    initialNumItems: pageSize,
  });

  const {
    record: viewedRecord,
    open: openRecord,
    close: closeRecord,
  } = useViewedRecord(paginatedResult.results, paginatedResult.status);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const { mutateAsync: deleteEntry } = useDeleteKnowledgeEntry();

  const handleRowClick = useCallback(
    (row: Row<KnowledgeEntryItem>) => {
      openRecord(row.original._id);
    },
    [openRecord],
  );

  const handleClearSelection = useCallback(() => {
    setRowSelection({});
  }, []);

  const handleDeleteItem = useCallback(
    async (id: string) => {
      // RowSelectionState keys are the row `_id`s by construction (getRowId).
      await deleteEntry({ entryId: id });
    },
    [deleteEntry],
  );

  const list = useListPage<KnowledgeEntryItem>({
    dataSource: {
      type: 'paginated',
      results: paginatedResult.results,
      status: paginatedResult.status,
      loadMore: paginatedResult.loadMore,
      isLoading: paginatedResult.isLoading,
    },
    pageSize,
    search: {
      fields: ['topic', 'content'],
      placeholder: searchPlaceholder,
    },
    approxRowCount: count,
    entityLabel: {
      one: t('entityLabelOne'),
      other: t('title').toLowerCase(),
    },
  });

  return (
    <>
      <DataTable
        columns={columns}
        stickyLayout={stickyLayout}
        enableRowSelection
        rowSelection={rowSelection}
        onRowSelectionChange={setRowSelection}
        onRowClick={handleRowClick}
        actionMenu={
          <KnowledgeEntriesActionMenu
            organizationId={organizationId}
            createOpen={createOpen}
            onCreateOpenChange={setCreateOpen}
          />
        }
        emptyState={{
          icon: BookOpen,
          title: tEmpty('knowledgeEntries.title'),
          description: tEmpty('knowledgeEntries.description'),
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

      {viewedRecord && (
        <KnowledgeEntryViewDialog
          isOpen
          onClose={closeRecord}
          entry={viewedRecord}
        />
      )}
    </>
  );
}
