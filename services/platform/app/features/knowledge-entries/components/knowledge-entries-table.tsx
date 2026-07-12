'use client';

import type { Row, RowSelectionState } from '@tanstack/react-table';
import { BookOpen } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';

import { DataTable } from '@/app/components/ui/data-table/data-table';
import { BulkDeleteBar } from '@/app/components/ui/data-table/data-table-bulk-actions';
import { useListPage } from '@/app/hooks/use-list-page';
import { toId } from '@/convex/lib/type_cast_helpers';
import { useT } from '@/lib/i18n/client';

import { useDeleteKnowledgeEntry } from '../hooks/mutations';
import {
  useApproxKnowledgeEntryCount,
  useListKnowledgeEntriesPaginated,
  type KnowledgeEntryItem,
} from '../hooks/queries';
import { useKnowledgeEntriesTableConfig } from '../hooks/use-knowledge-entries-table-config';
import { KnowledgeEntriesActionMenu } from './knowledge-entries-action-menu';
import { ViewKnowledgeEntryDialog } from './knowledge-entry-view-dialog';

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

  const [viewingEntryId, setViewingEntryId] = useState<string | null>(null);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const { mutateAsync: deleteEntry } = useDeleteKnowledgeEntry();

  const viewingEntry = useMemo(
    () =>
      viewingEntryId
        ? (paginatedResult.results.find((e) => e._id === viewingEntryId) ??
          null)
        : null,
    [viewingEntryId, paginatedResult.results],
  );

  const handleRowClick = useCallback((row: Row<KnowledgeEntryItem>) => {
    setViewingEntryId(row.original._id);
  }, []);

  const handleClearSelection = useCallback(() => {
    setRowSelection({});
  }, []);

  const handleDeleteItem = useCallback(
    async (id: string) => {
      // RowSelectionState keys are the row `_id`s by construction (getRowId).
      await deleteEntry({ entryId: toId<'knowledgeEntries'>(id) });
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

      {viewingEntry && (
        <ViewKnowledgeEntryDialog
          isOpen={!!viewingEntry}
          onClose={() => setViewingEntryId(null)}
          entry={viewingEntry}
        />
      )}
    </>
  );
}
