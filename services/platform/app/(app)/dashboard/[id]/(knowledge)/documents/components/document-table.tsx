'use client';

import { useMemo, useState, useCallback, useEffect } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Monitor, ClipboardList, RefreshCw } from 'lucide-react';
import { type ColumnDef, type Row, type SortingState } from '@tanstack/react-table';
import { DataTable } from '@/components/ui/data-table';
import { Stack, HStack } from '@/components/ui/layout';
import Pagination from '@/components/ui/pagination';
import BreadcrumbNavigation from './breadcrumb-navigation';
import { formatFileSize } from '@/lib/utils/document-helpers';
import { OneDriveIcon } from '@/components/ui/icons';
import { DocumentItem } from '@/types/documents';
import DocumentRowActions from './document-row-actions';
import DocumentPreviewModal from './document-preview-modal';
import DocumentIcon from '@/components/ui/document-icon';
import RagStatusBadge from './rag-status-badge';
import { DocumentsActionMenu } from './documents-action-menu';
import { useT } from '@/lib/i18n';
import { TableDateCell } from '@/components/ui/table-date-cell';
import { useDebounce } from '@/hooks/use-debounce';
import { useUrlModal } from '@/hooks/use-url-modal';

export interface DocumentTableProps {
  items: DocumentItem[];
  total: number;
  currentPage: number;
  hasNextPage: boolean;
  pageSize: number;
  searchQuery?: string;
  organizationId: string;
  currentFolderPath?: string;
  hasMicrosoftAccount?: boolean;
  initialSortField?: string;
  initialSortOrder?: 'asc' | 'desc';
}

export default function DocumentTable({
  items,
  total,
  currentPage,
  hasNextPage,
  pageSize,
  searchQuery,
  organizationId,
  currentFolderPath,
  hasMicrosoftAccount,
  initialSortField = '_creationTime',
  initialSortOrder = 'desc',
}: DocumentTableProps) {
  const { t: tDocuments } = useT('documents');
  const { t: tTables } = useT('tables');
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [query, setQuery] = useState(searchQuery ?? '');

  // URL-based modal state for document preview
  // This persists the preview modal state in URL params for bookmarkability and link sharing
  const { itemId: previewDocumentId, isOpen: previewOpen, openModal: openPreview, closeModal: closePreview } = useUrlModal({
    paramKey: 'doc',
  });

  // Derive preview data from the selected document ID
  const previewDocument = useMemo(() => {
    if (!previewDocumentId) return null;
    return items.find((item) => item.id === previewDocumentId) ?? null;
  }, [items, previewDocumentId]);

  const previewPath = previewDocument?.storagePath ?? null;
  const previewFileName = previewDocument?.name ?? null;

  // Debounce search query for URL updates
  const debouncedQuery = useDebounce(query, 300);

  // Initialize sorting state from props
  const initialSorting: SortingState = useMemo(() => [
    { id: initialSortField, desc: initialSortOrder === 'desc' }
  ], [initialSortField, initialSortOrder]);

  const baseParams = useMemo(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete('page');
    return params;
  }, [searchParams]);

  // Update URL when debounced search changes
  useEffect(() => {
    // Skip URL update if the debounced query matches the initial search query
    if (debouncedQuery === searchQuery) return;

    const params = new URLSearchParams(baseParams.toString());
    if (debouncedQuery.trim().length > 0) {
      params.set('query', debouncedQuery.trim());
    } else {
      params.delete('query');
    }
    params.delete('page'); // Reset to first page when searching
    const url = params.toString() ? `${pathname}?${params}` : pathname;
    router.push(url);
  }, [debouncedQuery, baseParams, pathname, router, searchQuery]);

  const handleSortingChange = useCallback(
    (sorting: SortingState | ((prev: SortingState) => SortingState)) => {
      const newSorting = typeof sorting === 'function' ? sorting(initialSorting) : sorting;
      const params = new URLSearchParams(searchParams.toString());
      if (newSorting.length > 0) {
        params.set('sort', newSorting[0].id);
        params.set('sortOrder', newSorting[0].desc ? 'desc' : 'asc');
      } else {
        params.delete('sort');
        params.delete('sortOrder');
      }
      params.delete('page'); // Reset to first page when sorting changes
      const url = params.toString() ? `${pathname}?${params}` : pathname;
      router.push(url);
    },
    [searchParams, pathname, router, initialSorting],
  );

  const handleSearchChange = useCallback((value: string) => {
    setQuery(value);
  }, []);

  // Memoize row className function to avoid recreation on every render
  const getRowClassName = useCallback(
    (row: Row<DocumentItem>) =>
      row.original.type === 'folder' ? 'cursor-pointer' : '',
    [],
  );

  const handleFolderClick = useCallback(
    (item: DocumentItem) => {
      const params = new URLSearchParams(baseParams.toString());
      params.set(
        'folderPath',
        item.storagePath?.replace(organizationId, '') ?? '',
      );
      const url = `${pathname}?${params}`;
      router.push(url);
    },
    [baseParams, organizationId, pathname, router],
  );

  const handleRowClick = useCallback(
    (row: Row<DocumentItem>) => {
      const item = row.original;
      if (item.type === 'folder') {
        handleFolderClick(item);
      }
    },
    [handleFolderClick],
  );

  const handleDocumentClick = useCallback(
    (item: DocumentItem, e: React.MouseEvent) => {
      e.stopPropagation();
      if (item.type === 'file') {
        // Open preview modal via URL state
        openPreview(item.id);
      }
      if (item.type === 'folder' && item.storagePath) {
        handleFolderClick(item);
      }
    },
    [handleFolderClick, openPreview],
  );

  // Define columns using TanStack Table
  const columns = useMemo<ColumnDef<DocumentItem>[]>(
    () => [
      {
        accessorKey: 'name',
        header: tTables('headers.document'),
        cell: ({ row }) => (
          <HStack gap={3}>
            <DocumentIcon
              fileName={
                row.original.type === 'folder'
                  ? 'folder'
                  : (row.original.name ?? '')
              }
            />
            <button
              type="button"
              title={row.original.name ?? ''}
              className="text-left"
              onClick={(e) => handleDocumentClick(row.original, e)}
            >
              <div className="text-sm font-medium text-primary hover:underline truncate max-w-[30rem]">
                {row.original.name ?? ''}
              </div>
            </button>
          </HStack>
        ),
      },
      {
        accessorKey: 'size',
        header: tTables('headers.size'),
        size: 128,
        cell: ({ row }) =>
          row.original.type === 'folder'
            ? '—'
            : formatFileSize(row.original.size ?? 0),
      },
      {
        id: 'source',
        header: tTables('headers.source'),
        size: 96,
        cell: ({ row }) => (
          <HStack gap={2}>
            {row.original.sourceProvider === 'onedrive' &&
              row.original.sourceMode === 'auto' && (
                <div className="relative">
                  <OneDriveIcon className="size-6" />
                  <RefreshCw className="size-4 text-background absolute bottom-0 right-0.5 p-0.5 rounded-full bg-foreground" />
                </div>
              )}
            {row.original.sourceProvider === 'onedrive' &&
              row.original.sourceMode === 'manual' && (
                <OneDriveIcon className="size-6" />
              )}
            {row.original.sourceProvider === 'upload' && (
              <Monitor className="size-6" />
            )}
          </HStack>
        ),
      },
      {
        id: 'ragStatus',
        header: tTables('headers.ragStatus'),
        size: 128,
        cell: ({ row }) =>
          row.original.type === 'folder' ? (
            <span className="text-muted-foreground text-sm">—</span>
          ) : (
            <RagStatusBadge
              status={row.original.ragStatus}
              indexedAt={row.original.ragIndexedAt}
              error={row.original.ragError}
              documentId={row.original.id}
            />
          ),
      },
      {
        accessorKey: 'lastModified',
        header: () => <span className="text-right w-full block">{tTables('headers.modified')}</span>,
        size: 192,
        cell: ({ row }) => (
          <TableDateCell
            date={row.original.lastModified}
            preset="short"
            alignRight
          />
        ),
      },
      {
        id: 'actions',
        size: 160,
        cell: ({ row }) => (
          <HStack justify="end">
            <DocumentRowActions
              documentId={row.original.id}
              itemType={row.original.type}
              name={row.original.name ?? null}
              syncConfigId={row.original.syncConfigId}
              isDirectlySelected={row.original.isDirectlySelected}
              sourceMode={row.original.sourceMode}
            />
          </HStack>
        ),
      },
    ],
    [handleDocumentClick, tTables],
  );

  return (
    <Stack gap={4}>
      {/* Breadcrumb Navigation */}
      {currentFolderPath && (
        <BreadcrumbNavigation currentFolderPath={currentFolderPath} />
      )}

      <DataTable
        columns={columns}
        data={items}
        getRowId={(row) => row.id}
        onRowClick={handleRowClick}
        rowClassName={getRowClassName}
        sorting={{
          initialSorting: initialSorting,
          onSortingChange: handleSortingChange,
        }}
        search={{
          value: query,
          onChange: handleSearchChange,
          placeholder: tDocuments('searchPlaceholder'),
          className: 'w-full sm:w-[300px]',
        }}
        actionMenu={
          <DocumentsActionMenu
            organizationId={organizationId}
            hasMicrosoftAccount={hasMicrosoftAccount}
          />
        }
        emptyState={{
          icon: ClipboardList,
          title: tDocuments('emptyState.title'),
          description: tDocuments('emptyState.description'),
        }}
        footer={
          <Pagination
            currentPage={currentPage}
            total={total}
            pageSize={pageSize}
            hasNextPage={hasNextPage}
          />
        }
      />

      {/* Document Preview Modal */}
      <DocumentPreviewModal
        open={previewOpen}
        onOpenChange={(open) => !open && closePreview()}
        organizationId={organizationId}
        storagePath={previewPath ?? undefined}
        documentId={previewDocumentId ?? undefined}
        fileName={previewFileName ?? undefined}
      />
    </Stack>
  );
}
