'use client';

import { useMemo, useState, useCallback, ChangeEvent } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Search, Monitor, ClipboardList, RefreshCw } from 'lucide-react';
import { type ColumnDef } from '@tanstack/react-table';
import { DataTable, DataTableEmptyState } from '@/components/ui/data-table';
import { Input } from '@/components/ui/input';
import Pagination from '@/components/ui/pagination';
import ImportDocumentsMenu from './import-documents-menu';
import BreadcrumbNavigation from './breadcrumb-navigation';
import { formatFileSize } from '@/lib/utils/document-helpers';
import { OneDriveIcon } from '@/components/ui/icons';
import { DocumentItem } from '@/types/documents';
import DocumentActions from './document-actions';
import DocumentPreviewModal from './document-preview-modal';
import DocumentIcon from '@/components/ui/document-icon';
import RagStatusBadge from './rag-status-badge';
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
}: DocumentTableProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [query, setQuery] = useState(searchQuery ?? '');
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const [previewDocumentId, setPreviewDocumentId] = useState<string | null>(
    null,
  );
  const [previewFileName, setPreviewFileName] = useState<string | null>(null);

  const baseParams = useMemo(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete('page');
    return params;
  }, [searchParams]);

  const handleSearchChange = (e: ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setQuery(value);
    const params = new URLSearchParams(baseParams.toString());
    if (value.trim().length > 0) {
      params.set('query', value.trim());
    } else {
      params.delete('query');
    }
    params.delete('page'); // Reset to first page when searching
    const url = params.toString() ? `${pathname}?${params}` : pathname;
    router.push(url);
  };

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
    (item: DocumentItem) => {
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
        if (item.storagePath) {
          setPreviewPath(item.storagePath);
          setPreviewDocumentId(null);
          setPreviewFileName(item.name ?? null);
        } else {
          setPreviewDocumentId(item.id);
          setPreviewPath(null);
          setPreviewFileName(item.name ?? null);
        }
        setPreviewOpen(true);
      }
      if (item.type === 'folder' && item.storagePath) {
        handleFolderClick(item);
      }
    },
    [handleFolderClick],
  );

  // Define columns using TanStack Table
  const columns = useMemo<ColumnDef<DocumentItem>[]>(
    () => [
      {
        accessorKey: 'name',
        header: 'Document',
        cell: ({ row }) => (
          <div className="flex items-center gap-3">
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
          </div>
        ),
      },
      {
        accessorKey: 'size',
        header: 'Size',
        size: 128,
        cell: ({ row }) =>
          row.original.type === 'folder'
            ? '—'
            : formatFileSize(row.original.size ?? 0),
      },
      {
        id: 'source',
        header: 'Source',
        size: 96,
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
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
          </div>
        ),
      },
      {
        id: 'ragStatus',
        header: 'RAG Status',
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
        header: () => <span className="text-right w-full block">Modified</span>,
        size: 192,
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground text-right block">
            {row.original.lastModified
              ? new Date(row.original.lastModified).toLocaleDateString()
              : '—'}
          </span>
        ),
      },
      {
        id: 'actions',
        size: 160,
        cell: ({ row }) => (
          <DocumentActions
            organizationId={organizationId}
            documentId={row.original.id}
            storagePath={row.original.storagePath ?? ''}
            itemType={row.original.type}
            name={row.original.name ?? null}
            syncConfigId={row.original.syncConfigId}
            isDirectlySelected={row.original.isDirectlySelected}
            sourceMode={row.original.sourceMode}
          />
        ),
      },
    ],
    [organizationId, handleDocumentClick],
  );

  const emptyDocuments = items.length === 0 && !query;

  if (emptyDocuments) {
    return (
      <DataTableEmptyState
        icon={ClipboardList}
        title="No documents yet"
        description="Import documents to make your AI smarter"
        action={
          <ImportDocumentsMenu
            organizationId={organizationId}
            hasMicrosoftAccount={hasMicrosoftAccount}
          />
        }
      />
    );
  }

  return (
    <div className="space-y-4">
      {/* Breadcrumb Navigation */}
      {currentFolderPath && (
        <BreadcrumbNavigation currentFolderPath={currentFolderPath} />
      )}

      <DataTable
        columns={columns}
        data={items}
        getRowId={(row) => row.id}
        onRowClick={handleRowClick}
        rowClassName={(row) =>
          row.original.type === 'folder' ? 'cursor-pointer' : ''
        }
        header={
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="relative w-full sm:w-[300px]">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <Input
                value={query}
                onChange={handleSearchChange}
                placeholder="Search documents..."
                className="pl-8"
              />
            </div>
            <div className="flex items-center gap-3">
              <ImportDocumentsMenu
                organizationId={organizationId}
                hasMicrosoftAccount={hasMicrosoftAccount}
              />
            </div>
          </div>
        }
        emptyState={{
          title: 'No results found',
          description: 'Try adjusting your search criteria',
          isFiltered: true,
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
        onOpenChange={setPreviewOpen}
        organizationId={organizationId}
        storagePath={previewPath ?? undefined}
        documentId={previewDocumentId ?? undefined}
        fileName={previewFileName ?? undefined}
      />
    </div>
  );
}
