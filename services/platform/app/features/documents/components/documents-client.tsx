'use client';

import { useMemo, useState, useCallback } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useQuery } from 'convex/react';
import { Monitor, ClipboardList, RefreshCw } from 'lucide-react';
import { type ColumnDef, type Row } from '@tanstack/react-table';
import { api } from '@/convex/_generated/api';
import { DataTable } from '@/app/components/ui/data-table/data-table';
import { DataTableSkeleton } from '@/app/components/ui/data-table/data-table-skeleton';
import { HStack } from '@/app/components/ui/layout/layout';
import { Badge } from '@/app/components/ui/feedback/badge';
import { Skeleton } from '@/app/components/ui/feedback/skeleton';
import { BreadcrumbNavigation } from './breadcrumb-navigation';
import { formatBytes } from '@/lib/utils/format/number';
import { OneDriveIcon } from '@/app/components/icons/onedrive-icon';
import type { DocumentItem } from '@/types/documents';
import { DocumentRowActions } from './document-row-actions';
import { DocumentPreviewDialog } from './document-preview-dialog';
import { DocumentIcon } from '@/app/components/ui/data-display/document-icon';
import { RagStatusBadge } from './rag-status-badge';
import { DocumentsActionMenu } from './documents-action-menu';
import { useT } from '@/lib/i18n/client';
import { TableDateCell } from '@/app/components/ui/data-display/table-date-cell';
import { useDebounce } from '@/app/hooks/use-debounce';
import { useListTeams } from '@/app/features/settings/teams/hooks/use-list-teams';

interface DocumentsClientProps {
  organizationId: string;
  searchQuery?: string;
  currentFolderPath?: string;
  docId?: string;
  hasMicrosoftAccount?: boolean;
}

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
        { header: t('headers.ragStatus'), size: 128 },
        { header: t('headers.modified'), size: 192 },
        { isAction: true, size: 160 },
      ]}
      stickyLayout
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

  // Fetch all teams for mapping team IDs to names
  // In trusted headers mode, teams come from JWT claims
  // In normal auth mode, teams come from the teamMember database table
  const { teams, isLoading: isLoadingTeams } = useListTeams(organizationId);

  // Create a map of team ID to team name for efficient lookups
  const teamMap = useMemo(() => {
    if (!teams) return new Map<string, string>();
    return new Map(teams.map((team: { id: string; name: string }) => [team.id, team.name]));
  }, [teams]);

  const queryArgs = useMemo(
    () => ({
      organizationId,
      query: debouncedQuery || undefined,
      folderPath: currentFolderPath || undefined,
      cursor: null,
      numItems: 20,
    }),
    [organizationId, debouncedQuery, currentFolderPath],
  );

  const documentsResult = useQuery(api.documents.queries.getDocumentsCursor, queryArgs);

  const previewDocument = useMemo(() => {
    if (!docId || !documentsResult) return null;
    return (
      (documentsResult.page as DocumentItem[]).find(
        (item) => item.id === docId,
      ) ?? null
    );
  }, [documentsResult, docId]);

  const previewPath = previewDocument?.storagePath ?? null;
  const previewFileName = previewDocument?.name ?? null;

  const handleSearchChange = useCallback(
    (value: string) => {
      setQuery(value);
      navigate({
        to: '/dashboard/$id/documents',
        params: { id: organizationId },
        search: {
          query: value.trim() || undefined,
          folderPath: currentFolderPath,
          doc: docId,
        },
      });
    },
    [navigate, organizationId, currentFolderPath, docId],
  );

  const getRowClassName = useCallback(
    (row: Row<DocumentItem>) =>
      row.original.type === 'folder' ? 'cursor-pointer' : '',
    [],
  );

  const handleFolderClick = useCallback(
    (item: DocumentItem) => {
      navigate({
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

  const handleRowClick = useCallback(
    (row: Row<DocumentItem>) => {
      const item = row.original;
      if (item.type === 'folder') {
        handleFolderClick(item);
      }
    },
    [handleFolderClick],
  );

  const openPreview = useCallback(
    (id: string) => {
      navigate({
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

  const closePreview = useCallback(() => {
    navigate({
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
                <div className="text-sm font-medium text-primary hover:underline truncate max-w-[30rem]">
                  {fileName}
                </div>
              </button>
            </HStack>
          );
        },
      },
      {
        accessorKey: 'size',
        header: tTables('headers.size'),
        size: 128,
        cell: ({ row }) => (
          <span className="whitespace-nowrap">
            {row.original.type === 'folder'
              ? '—'
              : formatBytes(row.original.size ?? 0)}
          </span>
        ),
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
            <span className="text-sm text-muted-foreground truncate max-w-[10rem]">
              {row.original.createdByName ?? '—'}
            </span>
          );
        },
      },
      {
        accessorKey: 'lastModified',
        header: () => (
          <span className="text-right w-full block">
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
    [handleDocumentClick, isLoadingTeams, tTables, teamMap],
  );

  if (documentsResult === undefined) {
    return <DocumentsSkeleton />;
  }

  const items = documentsResult.page as DocumentItem[];

  return (
    <>
      {currentFolderPath && (
        <BreadcrumbNavigation currentFolderPath={currentFolderPath} />
      )}

      <DataTable
        columns={columns}
        data={items}
        getRowId={(row) => row.id}
        onRowClick={handleRowClick}
        rowClassName={getRowClassName}
        stickyLayout
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
