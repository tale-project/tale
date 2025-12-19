'use client';

import { useMemo, useState, ChangeEvent } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import Pagination from '@/components/ui/pagination';
import { Search, Monitor, ClipboardList } from 'lucide-react';
import { RefreshCw } from 'lucide-react';
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

  const handleFolderClick = (item: DocumentItem) => {
    const params = new URLSearchParams(baseParams.toString());

    params.set(
      'folderPath',
      item.storagePath?.replace(organizationId, '') ?? '',
    );

    const url = `${pathname}?${params}`;
    router.push(url);
  };

  const emptyQuery = items.length === 0 && query;

  if (emptyQuery) {
    return (
      <div className="space-y-4">
        {/* Breadcrumb Navigation */}
        {currentFolderPath && (
          <BreadcrumbNavigation currentFolderPath={currentFolderPath} />
        )}
        {/* Search and Actions */}
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
            <ImportDocumentsMenu organizationId={organizationId} />
          </div>
        </div>

        {/* Empty folder message */}
        <div className="grid place-items-center h-[40vh]">
          <div className="text-center max-w-[24rem] flex flex-col items-center">
            <div className="text-lg font-semibold mb-2">No results found</div>
          </div>
        </div>
      </div>
    );
  }

  const emptyDocuments = items.length === 0 && !query;

  if (emptyDocuments) {
    return (
      <div className="grid place-items-center flex-[1_1_0] ring-1 ring-border rounded-xl p-4">
        <div className="text-center max-w-[24rem] flex flex-col items-center">
          <ClipboardList className="size-6 text-secondary mb-5" />
          <div className="text-lg font-semibold leading-tight mb-2">
            No documents yet
          </div>
          <p className="text-sm text-muted-foreground mb-5">
            Import documents to make your AI smarter
          </p>
          <ImportDocumentsMenu organizationId={organizationId} />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Breadcrumb Navigation */}
      {currentFolderPath && (
        <BreadcrumbNavigation currentFolderPath={currentFolderPath} />
      )}

      {/* Search and Actions */}
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
          <ImportDocumentsMenu organizationId={organizationId} />
        </div>
      </div>

      {/* Table */}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Document</TableHead>
            <TableHead>Size</TableHead>
            <TableHead>Source</TableHead>
            <TableHead>RAG Status</TableHead>
            <TableHead className="text-right">Modified</TableHead>
            <TableHead></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody className="min-h-[40vh]">
          {items?.map((item) => {
            return (
              <TableRow
                key={item.id}
                className={
                  item.type === 'folder'
                    ? 'cursor-pointer hover:bg-secondary/20'
                    : ''
                }
                onClick={
                  item.type === 'folder'
                    ? () => handleFolderClick(item)
                    : undefined
                }
              >
                <TableCell>
                  <div className="flex items-center gap-3">
                    <DocumentIcon
                      fileName={
                        item.type === 'folder' ? 'folder' : (item.name ?? '')
                      }
                    />
                    <button
                      type="button"
                      title={item.name ?? ''}
                      className="text-left"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (item.type === 'file') {
                          // For uploaded files without storagePath, use documentId
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
                      }}
                    >
                      <div className="text-sm font-medium text-primary hover:underline truncate max-w-[30rem]">
                        {item.name ?? ''}
                      </div>
                    </button>
                  </div>
                </TableCell>
                <TableCell className="max-w-[8rem]">
                  {item.type === 'folder'
                    ? '—'
                    : formatFileSize(item.size ?? 0)}
                </TableCell>
                <TableCell className="max-w-[6rem]">
                  <div className="flex items-center gap-2">
                    {item.sourceProvider === 'onedrive' &&
                      item.sourceMode === 'auto' && (
                        <div className="relative">
                          <OneDriveIcon className="size-6" />
                          <RefreshCw className="size-4 text-background absolute bottom-0 right-0.5 p-0.5 rounded-full bg-foreground" />
                        </div>
                      )}
                    {item.sourceProvider === 'onedrive' &&
                      item.sourceMode === 'manual' && (
                        <OneDriveIcon className="size-6" />
                      )}
                    {item.sourceProvider === 'upload' && (
                      <Monitor className="size-6" />
                    )}
                  </div>
                </TableCell>
                <TableCell className="max-w-[8rem]">
                  {item.type === 'folder' ? (
                    <span className="text-muted-foreground text-sm">—</span>
                  ) : (
                    <RagStatusBadge
                      status={item.ragStatus}
                      indexedAt={item.ragIndexedAt}
                      error={item.ragError}
                      documentId={item.id}
                    />
                  )}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground max-w-[12rem] text-right">
                  {item.lastModified
                    ? new Date(item.lastModified).toLocaleDateString()
                    : '—'}
                </TableCell>
                <TableCell className="max-w-[10rem]">
                  <DocumentActions
                    organizationId={organizationId}
                    documentId={item.id}
                    storagePath={item.storagePath ?? ''}
                    itemType={item.type}
                    name={item.name ?? null}
                    syncConfigId={item.syncConfigId}
                    isDirectlySelected={item.isDirectlySelected}
                    sourceMode={item.sourceMode}
                  />
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      {/* Pagination */}
      <Pagination
        currentPage={currentPage}
        total={total}
        pageSize={pageSize}
        hasNextPage={hasNextPage}
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
