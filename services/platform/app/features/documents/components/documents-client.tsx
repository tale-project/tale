'use client';

import { useNavigate } from '@tanstack/react-router';
import { type ColumnDef, type Row } from '@tanstack/react-table';
import { Monitor, ClipboardList, RefreshCw } from 'lucide-react';
import { useMemo, useState, useCallback } from 'react';

import type { DocumentItem } from '@/types/documents';

import { OneDriveIcon } from '@/app/components/icons/onedrive-icon';
import { SharePointIcon } from '@/app/components/icons/sharepoint-icon';
import { DocumentIcon } from '@/app/components/ui/data-display/document-icon';
import { TableDateCell } from '@/app/components/ui/data-display/table-date-cell';
import { DataTable } from '@/app/components/ui/data-table/data-table';
import { DataTableSkeleton } from '@/app/components/ui/data-table/data-table-skeleton';
import { Badge } from '@/app/components/ui/feedback/badge';
import { Skeleton } from '@/app/components/ui/feedback/skeleton';
import { HStack } from '@/app/components/ui/layout/layout';
import { useTeamCollection } from '@/app/features/settings/teams/hooks/collections';
import { useTeams } from '@/app/features/settings/teams/hooks/queries';
import { useDebounce } from '@/app/hooks/use-debounce';
import { useListPage } from '@/app/hooks/use-list-page';
import { useTeamFilter } from '@/app/hooks/use-team-filter';
import { useT } from '@/lib/i18n/client';
import { filterByTextSearch } from '@/lib/utils/filtering';
import { formatBytes } from '@/lib/utils/format/number';

import { useListDocumentsPaginated } from '../hooks/queries';
import { BreadcrumbNavigation } from './breadcrumb-navigation';
import { DocumentPreviewDialog } from './document-preview-dialog';
import { DocumentRowActions } from './document-row-actions';
import { DocumentsActionMenu } from './documents-action-menu';
import { RagStatusBadge } from './rag-status-badge';

interface DocumentsClientProps {
  organizationId: string;
  searchQuery?: string;
  currentFolderPath?: string;
  docId?: string;
  hasMicrosoftAccount?: boolean;
}

const PAGE_SIZE = 20;

function DocumentsSkeleton() {
  const { t } = useT('tables');
  const { t: tDocuments } = useT('documents');

  return (
    <DataTableSkeleton
      rows={10}
      columns={[
        { header: t('headers.document') },
        { header: t('headers.size'), size: 128 },
        { header: t('headers.source'), size: 96 },
        { header: t('headers.ragStatus'), size: 160 },
        { header: t('headers.teams'), size: 160 },
        { header: t('headers.uploadedBy'), size: 160 },
        { header: t('headers.modified'), size: 192 },
        { isAction: true, size: 160 },
      ]}
      stickyLayout
      infiniteScroll
      searchPlaceholder={tDocuments('searchPlaceholder')}
      actionMenu={<Skeleton className="h-9 w-40" />}
    />
  );
}

export function DocumentsClient({
  organizationId,
  searchQuery,
  currentFolderPath,
  docId,
  hasMicrosoftAccount = false,
}: DocumentsClientProps) {
  const navigate = useNavigate();
  const { t: tDocuments } = useT('documents');
  const { t: tTables } = useT('tables');

  const [query, setQuery] = useState(searchQuery ?? '');
  const debouncedQuery = useDebounce(query, 300);

  const teamCollection = useTeamCollection(organizationId);
  const { teams, isLoading: isLoadingTeams } = useTeams(teamCollection);

  const teamMap = useMemo(() => {
    if (!teams) return new Map<string, string>();
    return new Map(
      teams.map((team: { id: string; name: string }) => [team.id, team.name]),
    );
  }, [teams]);

  const { selectedTeamId } = useTeamFilter();

  const paginatedResult = useListDocumentsPaginated({
    organizationId,
    initialNumItems: PAGE_SIZE,
  });

  const filteredResults = useMemo(() => {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Backend returns DocumentItemResponse; cast to DocumentItem for table
    let filtered = paginatedResult.results as DocumentItem[];
    if (selectedTeamId) {
      filtered = filtered.filter((doc) =>
        doc.teamTags?.includes(selectedTeamId),
      );
    }
    if (currentFolderPath) {
      filtered = filtered.filter((doc) =>
        doc.storagePath?.startsWith(`${organizationId}${currentFolderPath}`),
      );
    }
    if (debouncedQuery) {
      filtered = filterByTextSearch(filtered, debouncedQuery, ['name']);
    }
    return filtered;
  }, [
    paginatedResult.results,
    selectedTeamId,
    currentFolderPath,
    organizationId,
    debouncedQuery,
  ]);

  const list = useListPage({
    dataSource: {
      type: 'paginated',
      results: filteredResults,
      status: paginatedResult.status,
      loadMore: paginatedResult.loadMore,
      isLoading: paginatedResult.isLoading,
    },
    pageSize: PAGE_SIZE,
    search: {
      value: query,
      onChange: (value: string) => {
        setQuery(value);
        void navigate({
          to: '/dashboard/$id/documents',
          params: { id: organizationId },
          search: {
            query: value.trim() || undefined,
            folderPath: currentFolderPath,
            doc: docId,
          },
        });
      },
      placeholder: tDocuments('searchPlaceholder'),
    },
    getRowId: (row) => row.id,
  });

  const previewDocument = useMemo(() => {
    if (!docId || !filteredResults.length) return null;
    return filteredResults.find((item) => item.id === docId) ?? null;
  }, [filteredResults, docId]);

  const previewPath = previewDocument?.storagePath ?? null;
  const previewFileName = previewDocument?.name ?? null;

  const getRowClassName = useCallback(
    (row: Row<DocumentItem>) =>
      row.original.type === 'folder' ? 'cursor-pointer' : '',
    [],
  );

  const handleFolderClick = useCallback(
    (item: DocumentItem) => {
      void navigate({
        to: '/dashboard/$id/documents',
        params: { id: organizationId },
        search: {
          query: query.trim() || undefined,
          folderPath: item.storagePath?.replace(organizationId, '') ?? '',
        },
      });
    },
    [navigate, organizationId, query],
  );

  const openPreview = useCallback(
    (id: string) => {
      void navigate({
        to: '/dashboard/$id/documents',
        params: { id: organizationId },
        search: {
          query: query.trim() || undefined,
          folderPath: currentFolderPath,
          doc: id,
        },
      });
    },
    [navigate, organizationId, query, currentFolderPath],
  );

  const handleRowClick = useCallback(
    (row: Row<DocumentItem>) => {
      if (row.original.type === 'folder' && row.original.storagePath) {
        handleFolderClick(row.original);
      } else if (row.original.type === 'file') {
        openPreview(row.original.id);
      }
    },
    [handleFolderClick, openPreview],
  );

  const closePreview = useCallback(() => {
    void navigate({
      to: '/dashboard/$id/documents',
      params: { id: organizationId },
      search: {
        query: query.trim() || undefined,
        folderPath: currentFolderPath,
      },
    });
  }, [navigate, organizationId, query, currentFolderPath]);

  const handleDocumentClick = useCallback(
    (item: DocumentItem, e: React.MouseEvent) => {
      e.stopPropagation();
      if (item.type === 'file') {
        openPreview(item.id);
      }
      if (item.type === 'folder' && item.storagePath) {
        handleFolderClick(item);
      }
    },
    [handleFolderClick, openPreview],
  );

  const columns = useMemo<ColumnDef<DocumentItem>[]>(
    () => [
      {
        accessorKey: 'name',
        header: tTables('headers.document'),
        cell: ({ row }) => {
          const fullPath = row.original.name ?? '';
          const fileName = fullPath.split('/').pop() || fullPath;

          return (
            <HStack gap={3}>
              <DocumentIcon
                fileName={fileName}
                isFolder={row.original.type === 'folder'}
              />
              <button
                type="button"
                title={fullPath}
                className="text-left"
                onClick={(e) => handleDocumentClick(row.original, e)}
              >
                <div className="text-primary max-w-[30rem] truncate text-sm font-medium hover:underline">
                  {fileName}
                </div>
              </button>
            </HStack>
          );
        },
      },
      {
        accessorKey: 'size',
        header: () => (
          <span className="block w-full text-right">
            {tTables('headers.size')}
          </span>
        ),
        size: 128,
        cell: ({ row }) => (
          <span className="block text-right whitespace-nowrap">
            {row.original.type === 'folder' || !row.original.size
              ? '—'
              : formatBytes(row.original.size)}
          </span>
        ),
      },
      {
        id: 'source',
        header: () => (
          <span className="block w-full text-center">
            {tTables('headers.source')}
          </span>
        ),
        size: 96,
        cell: ({ row }) => (
          <HStack gap={2} justify="center">
            {row.original.sourceProvider === 'onedrive' &&
              row.original.sourceMode === 'auto' && (
                <div
                  className="relative"
                  title={tDocuments('sourceType.oneDriveSynced')}
                >
                  <OneDriveIcon className="size-6" />
                  <RefreshCw className="text-background bg-foreground absolute right-0.5 bottom-0 size-4 rounded-full p-0.5" />
                </div>
              )}
            {row.original.sourceProvider === 'onedrive' &&
              row.original.sourceMode === 'manual' && (
                <div title={tDocuments('sourceType.oneDrive')}>
                  <OneDriveIcon className="size-6" />
                </div>
              )}
            {row.original.sourceProvider === 'sharepoint' &&
              row.original.sourceMode === 'auto' && (
                <div
                  className="relative"
                  title={tDocuments('sourceType.sharePointSynced')}
                >
                  <SharePointIcon className="size-6" />
                  <RefreshCw className="text-background bg-foreground absolute right-0.5 bottom-0 size-4 rounded-full p-0.5" />
                </div>
              )}
            {row.original.sourceProvider === 'sharepoint' &&
              row.original.sourceMode === 'manual' && (
                <div title={tDocuments('sourceType.sharePoint')}>
                  <SharePointIcon className="size-6" />
                </div>
              )}
            {row.original.sourceProvider === 'upload' && (
              <div title={tDocuments('sourceType.uploaded')}>
                <Monitor className="size-6" />
              </div>
            )}
          </HStack>
        ),
      },
      {
        id: 'ragStatus',
        header: tTables('headers.ragStatus'),
        size: 160,
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
        id: 'teams',
        header: tTables('headers.teams'),
        size: 160,
        cell: ({ row }) => {
          const tags = row.original.teamTags;
          if (row.original.type === 'folder' || !tags || tags.length === 0) {
            return <span className="text-muted-foreground text-sm">—</span>;
          }
          if (isLoadingTeams) {
            return <Skeleton className="h-5 w-20" />;
          }
          return (
            <HStack gap={1} className="flex-wrap">
              {tags.slice(0, 2).map((tagId) => {
                const teamName = teamMap.get(tagId);
                if (!teamName) return null;
                return (
                  <Badge key={tagId} variant="blue" className="text-xs">
                    {teamName}
                  </Badge>
                );
              })}
              {tags.length > 2 && (
                <Badge variant="outline" className="text-xs">
                  +{tags.length - 2}
                </Badge>
              )}
            </HStack>
          );
        },
      },
      {
        id: 'uploadedBy',
        header: tTables('headers.uploadedBy'),
        size: 160,
        cell: ({ row }) => {
          if (row.original.type === 'folder') {
            return <span className="text-muted-foreground text-sm">—</span>;
          }
          return (
            <span className="text-muted-foreground max-w-[10rem] truncate text-sm">
              {row.original.createdByName ?? '—'}
            </span>
          );
        },
      },
      {
        accessorKey: 'lastModified',
        header: () => (
          <span className="block w-full text-right">
            {tTables('headers.modified')}
          </span>
        ),
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
              teamTags={row.original.teamTags}
            />
          </HStack>
        ),
      },
    ],
    [handleDocumentClick, isLoadingTeams, tTables, tDocuments, teamMap],
  );

  if (paginatedResult.status === 'LoadingFirstPage') {
    return <DocumentsSkeleton />;
  }

  return (
    <>
      {currentFolderPath && (
        <BreadcrumbNavigation currentFolderPath={currentFolderPath} />
      )}

      <DataTable
        columns={columns}
        onRowClick={handleRowClick}
        rowClassName={getRowClassName}
        stickyLayout
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
        {...list.tableProps}
      />

      <DocumentPreviewDialog
        open={!!docId}
        onOpenChange={(open) => !open && closePreview()}
        organizationId={organizationId}
        storagePath={previewPath ?? undefined}
        documentId={docId ?? undefined}
        fileName={previewFileName ?? undefined}
      />
    </>
  );
}
