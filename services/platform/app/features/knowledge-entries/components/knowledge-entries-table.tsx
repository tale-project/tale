'use client';

import { CatalogLoadError } from '@tale/ui/catalog/catalog-view';
import { DataTable } from '@tale/ui/data-table/data-table';
import { BulkDeleteBar } from '@tale/ui/data-table/data-table-bulk-actions';
import { useListPage } from '@tale/ui/use-list-page';
import type { Row, RowSelectionState } from '@tanstack/react-table';
import { BookOpen } from 'lucide-react';
import { useCallback, useState } from 'react';

import { useListReadRecovery } from '@/app/hooks/use-list-read-recovery';
import { useViewedRecord } from '@/app/hooks/use-viewed-record';
import { firstFailureDetail } from '@/app/lib/backend/adapters';
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
  const { columns, searchPlaceholder, pageSize } =
    useKnowledgeEntriesTableConfig();
  const paginatedResult = useListKnowledgeEntriesPaginated({
    organizationId,
    initialNumItems: pageSize,
  });

  const {
    record: viewedRecord,
    open: openRecord,
    close: closeRecord,
  } = useViewedRecord(
    paginatedResult.results,
    paginatedResult.status,
    (entry) => entry.documentId ?? entry._id,
  );
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const { mutateAsync: deleteEntry } = useDeleteKnowledgeEntry();

  const handleRowClick = useCallback(
    (row: Row<KnowledgeEntryItem>) => {
      openRecord(row.original.documentId ?? row.original._id);
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

  const { regionRef, retryRead, focusRegion, failedWithRows } =
    useListReadRecovery(paginatedResult);

  const list = useListPage<KnowledgeEntryItem>({
    dataSource: {
      type: 'paginated',
      results: paginatedResult.results,
      status: paginatedResult.status,
      loadMore: paginatedResult.loadMore,
      isLoading: paginatedResult.isLoading,
      // A failed first page is the table's error state with its retry,
      // never "No knowledge entries yet" (#3777).
      error: paginatedResult.error,
      retry: retryRead,
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
      {/* Rows already on screen outlive a failed read — a refresh, or a page
          a search or a scroll asked for — and the failure is named above
          them. */}
      <div
        ref={regionRef}
        role="region"
        aria-label={t('title')}
        tabIndex={-1}
        className="flex min-h-0 flex-1 flex-col gap-6 outline-none"
      >
        {failedWithRows && (
          <CatalogLoadError
            // Each failure is announced again; Try again keeps its node.
            failureKey={paginatedResult.errorCount}
            onFocusLost={focusRegion}
            message={t('refreshFailed')}
            onRetry={retryRead}
            isRetrying={paginatedResult.isRetrying}
          />
        )}
        <DataTable
          columns={columns}
          stickyLayout
          enableRowSelection
          rowSelection={rowSelection}
          onRowSelectionChange={setRowSelection}
          onRowClick={handleRowClick}
          // A refresh the reader did not start takes the table's error state
          // away while it runs; a focused Try again hands its focus to the
          // list, not to the page.
          onErrorFocusLost={focusRegion}
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
              onRowSelectionChange={setRowSelection}
              getItemLabel={(id) =>
                paginatedResult.results.find((item) => item._id === id)
                  ?.topic ?? id
              }
              onClearSelection={handleClearSelection}
              onDeleteItem={handleDeleteItem}
              onDeleteComplete={handleClearSelection}
              describeFailure={firstFailureDetail}
            />
          }
          {...list.tableProps}
        />
      </div>

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
