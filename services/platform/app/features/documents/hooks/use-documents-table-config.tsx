'use client';

import type { ColumnDef } from '@tanstack/react-table';

import { useMemo } from 'react';

import type { DocumentItem } from '@/types/documents';

import { CopyableTimestamp } from '@/app/components/ui/data-display/copyable-timestamp';
import { DocumentIcon } from '@/app/components/ui/data-display/document-icon';
import { Skeleton } from '@/app/components/ui/feedback/skeleton';
import { HStack } from '@/app/components/ui/layout/layout';
import { Text } from '@/app/components/ui/typography/text';
import { useT } from '@/lib/i18n/client';
import { formatBytes } from '@/lib/utils/format/number';

import { DocumentRowActions } from '../components/document-row-actions';
import { RagStatusBadge } from '../components/rag-status-badge';

type DocumentsT = ReturnType<typeof useT<'documents'>>['t'];

interface SourceInfo {
  title: string;
}

function getSourceInfo(
  sourceProvider: DocumentItem['sourceProvider'],
  sourceMode: DocumentItem['sourceMode'],
  t: DocumentsT,
): SourceInfo | null {
  if (sourceProvider === 'onedrive') {
    return {
      title:
        sourceMode === 'auto'
          ? t('sourceType.oneDriveSynced')
          : t('sourceType.oneDrive'),
    };
  }
  if (sourceProvider === 'sharepoint') {
    return {
      title:
        sourceMode === 'auto'
          ? t('sourceType.sharePointSynced')
          : t('sourceType.sharePoint'),
    };
  }
  if (sourceProvider === 'upload') {
    return {
      title: t('sourceType.uploaded'),
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
                className="cursor-pointer text-left"
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
        header: tTables('headers.size'),
        size: 128,
        meta: { headerLabel: tTables('headers.size') },
        cell: ({ row }) => (
          <Text as="span" className="block whitespace-nowrap">
            {row.original.type === 'folder' || !row.original.size
              ? '—'
              : formatBytes(row.original.size)}
          </Text>
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
        cell: ({ row }) => {
          const source = getSourceInfo(
            row.original.sourceProvider,
            row.original.sourceMode,
            tDocuments,
          );
          if (!source) return null;
          return (
            <Text as="span" variant="muted" className="block text-center">
              {source.title}
            </Text>
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
          const teamIds = row.original.teamIds ?? [];
          if (teamIds.length === 0) {
            return (
              <Text as="span" variant="muted" className="text-sm">
                {tDocuments('teamTags.orgWide')}
              </Text>
            );
          }
          if (isLoadingTeams) {
            return <Skeleton className="h-5 w-20" />;
          }
          const MAX_VISIBLE = 2;
          const names = teamIds
            .map((id) => teamMap.get(id))
            .filter((name): name is string => Boolean(name));
          const visible = names.slice(0, MAX_VISIBLE);
          const remaining = names.length - MAX_VISIBLE;
          return (
            <Text as="span" className="text-sm">
              {visible.join(', ')}
              {remaining > 0 && (
                <span className="text-muted-foreground">
                  {` +${remaining}`}
                </span>
              )}
            </Text>
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
          <span className="block w-full text-right">
            {tTables('headers.updated')}
          </span>
        ),
        size: 192,
        meta: {
          headerLabel: tTables('headers.updated'),
          align: 'right' as const,
        },
        cell: ({ row }) => (
          <CopyableTimestamp
            date={row.original.lastModified}
            preset="long" // preset="long" triggers timezone abbreviation appending
            customFormat="ll LT"
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
              teamIds={row.original.teamIds ?? []}
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
