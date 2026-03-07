'use client';

import type { ColumnDef } from '@tanstack/react-table';

import { Monitor, RefreshCw } from 'lucide-react';
import { useMemo } from 'react';

import type { DocumentItem } from '@/types/documents';

import { OneDriveIcon } from '@/app/components/icons/onedrive-icon';
import { SharePointIcon } from '@/app/components/icons/sharepoint-icon';
import { CopyableTimestamp } from '@/app/components/ui/data-display/copyable-timestamp';
import { DocumentIcon } from '@/app/components/ui/data-display/document-icon';
import { Badge } from '@/app/components/ui/feedback/badge';
import { Skeleton } from '@/app/components/ui/feedback/skeleton';
import { HStack } from '@/app/components/ui/layout/layout';
import { Text } from '@/app/components/ui/typography/text';
import { useT } from '@/lib/i18n/client';
import { formatBytes } from '@/lib/utils/format/number';

import { DocumentRowActions } from '../components/document-row-actions';
import { RagStatusBadge } from '../components/rag-status-badge';

type DocumentsT = ReturnType<typeof useT<'documents'>>['t'];

interface SourceInfo {
  icon: React.ReactElement;
  title: string;
  synced: boolean;
}

function getSourceInfo(
  sourceProvider: DocumentItem['sourceProvider'],
  sourceMode: DocumentItem['sourceMode'],
  t: DocumentsT,
): SourceInfo | null {
  if (sourceProvider === 'onedrive') {
    return {
      icon: <OneDriveIcon className="size-6" />,
      title:
        sourceMode === 'auto'
          ? t('sourceType.oneDriveSynced')
          : t('sourceType.oneDrive'),
      synced: sourceMode === 'auto',
    };
  }
  if (sourceProvider === 'sharepoint') {
    return {
      icon: <SharePointIcon className="size-6" />,
      title:
        sourceMode === 'auto'
          ? t('sourceType.sharePointSynced')
          : t('sourceType.sharePoint'),
      synced: sourceMode === 'auto',
    };
  }
  if (sourceProvider === 'upload') {
    return {
      icon: <Monitor className="size-6" />,
      title: t('sourceType.uploaded'),
      synced: false,
    };
  }
  return null;
}

interface DocumentsTableConfigParams {
  onDocumentClick: (item: DocumentItem, e: React.MouseEvent) => void;
  onFolderDeleted: () => void;
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
  onFolderDeleted,
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
                aria-label={
                  row.original.type === 'folder'
                    ? tDocuments('aria.openFolder', { name: fileName })
                    : tDocuments('aria.openDocument', { name: fileName })
                }
                onClick={(e) => onDocumentClick(row.original, e)}
              >
                <Text
                  as="div"
                  variant="label"
                  truncate
                  className="text-primary max-w-[30rem] hover:underline"
                >
                  {fileName}
                </Text>
              </button>
            </HStack>
          );
        },
      },
      {
        accessorKey: 'size',
        header: () => (
          <Text as="span" align="right" className="block w-full">
            {tTables('headers.size')}
          </Text>
        ),
        size: 128,
        meta: { headerLabel: tTables('headers.size'), align: 'right' as const },
        cell: ({ row }) => (
          <Text as="span" align="right" className="block whitespace-nowrap">
            {row.original.type === 'folder' || !row.original.size
              ? '—'
              : formatBytes(row.original.size)}
          </Text>
        ),
      },
      {
        id: 'source',
        header: () => (
          <Text as="span" align="center" className="block w-full">
            {tTables('headers.source')}
          </Text>
        ),
        size: 96,
        meta: {
          headerLabel: tTables('headers.source'),
          align: 'center' as const,
        },
        cell: ({ row }) => {
          const source = getSourceInfo(
            row.original.sourceProvider,
            row.original.sourceMode,
            tDocuments,
          );
          if (!source) return null;
          return (
            <HStack gap={2} justify="center">
              <div
                className={source.synced ? 'relative' : undefined}
                title={source.title}
              >
                {source.icon}
                {source.synced && (
                  <RefreshCw className="text-background bg-foreground absolute right-0.5 bottom-0 size-4 rounded-full p-0.5" />
                )}
              </div>
            </HStack>
          );
        },
      },
      {
        id: 'ragStatus',
        header: tTables('headers.ragStatus'),
        size: 160,
        meta: { skeleton: { type: 'badge' as const } },
        cell: ({ row }) =>
          row.original.type === 'folder' ? (
            <Text as="span" variant="muted">
              —
            </Text>
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
          if (row.original.type === 'folder') {
            return (
              <Text as="span" variant="muted">
                —
              </Text>
            );
          }
          const { teamId } = row.original;
          if (!teamId) {
            return (
              <Badge variant="outline" className="text-xs">
                {tDocuments('teamTags.orgWide')}
              </Badge>
            );
          }
          if (isLoadingTeams) {
            return <Skeleton className="h-5 w-20" />;
          }
          const teamName = teamMap.get(teamId);
          if (!teamName) {
            return (
              <Text as="span" variant="muted">
                —
              </Text>
            );
          }
          return (
            <Badge variant="blue" className="text-xs">
              {teamName}
            </Badge>
          );
        },
      },
      {
        id: 'uploadedBy',
        header: tTables('headers.uploadedBy'),
        size: 160,
        cell: ({ row }) => {
          if (row.original.type === 'folder') {
            return (
              <Text as="span" variant="muted">
                —
              </Text>
            );
          }
          return (
            <Text as="span" variant="muted" truncate className="max-w-[10rem]">
              {row.original.createdByName ?? '—'}
            </Text>
          );
        },
      },
      {
        accessorKey: 'lastModified',
        header: () => (
          <Text as="span" align="right" className="block w-full">
            {tTables('headers.modified')}
          </Text>
        ),
        size: 192,
        meta: {
          headerLabel: tTables('headers.modified'),
          align: 'right' as const,
        },
        cell: ({ row }) => (
          <CopyableTimestamp
            date={row.original.lastModified}
            preset="long"
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
              teamId={row.original.teamId}
              onFolderDeleted={onFolderDeleted}
            />
          </HStack>
        ),
      },
    ],
    [
      onDocumentClick,
      onFolderDeleted,
      isLoadingTeams,
      teamMap,
      tTables,
      tDocuments,
    ],
  );

  return {
    columns,
    stickyLayout: true,
    pageSize: 20,
    searchPlaceholder: tDocuments('searchPlaceholder'),
  };
}
