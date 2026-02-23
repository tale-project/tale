'use client';

import type { ColumnDef } from '@tanstack/react-table';

import { Monitor, RefreshCw } from 'lucide-react';
import { useMemo } from 'react';

import type { DocumentItem } from '@/types/documents';

import { OneDriveIcon } from '@/app/components/icons/onedrive-icon';
import { SharePointIcon } from '@/app/components/icons/sharepoint-icon';
import { DocumentIcon } from '@/app/components/ui/data-display/document-icon';
import { TableDateCell } from '@/app/components/ui/data-display/table-date-cell';
import { Badge } from '@/app/components/ui/feedback/badge';
import { Skeleton } from '@/app/components/ui/feedback/skeleton';
import { HStack } from '@/app/components/ui/layout/layout';
import { useT } from '@/lib/i18n/client';
import { formatBytes } from '@/lib/utils/format/number';

import { DocumentRowActions } from '../components/document-row-actions';
import { RagStatusBadge } from '../components/rag-status-badge';

interface DocumentsTableConfigParams {
  onDocumentClick: (item: DocumentItem, e: React.MouseEvent) => void;
  isLoadingTeams: boolean;
  teamMap: Map<string, string>;
}

interface DocumentsTableConfig {
  columns: ColumnDef<DocumentItem>[];
  stickyLayout: boolean;
  pageSize: number;
  searchPlaceholder: string;
}

export function useDocumentsTableConfig({
  onDocumentClick,
  isLoadingTeams,
  teamMap,
}: DocumentsTableConfigParams): DocumentsTableConfig {
  const { t: tTables } = useT('tables');
  const { t: tDocuments } = useT('documents');

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
                onClick={(e) => onDocumentClick(row.original, e)}
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
        meta: { headerLabel: tTables('headers.size'), align: 'right' as const },
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
        meta: {
          headerLabel: tTables('headers.source'),
          align: 'center' as const,
        },
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
        meta: { skeleton: { type: 'badge' as const } },
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
        meta: { skeleton: { type: 'badge' as const } },
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
        meta: {
          headerLabel: tTables('headers.modified'),
          align: 'right' as const,
        },
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
        meta: { isAction: true },
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
    [onDocumentClick, isLoadingTeams, teamMap, tTables, tDocuments],
  );

  return {
    columns,
    stickyLayout: true,
    pageSize: 20,
    searchPlaceholder: tDocuments('searchPlaceholder'),
  };
}
