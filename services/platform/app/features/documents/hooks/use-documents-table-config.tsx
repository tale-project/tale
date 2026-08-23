'use client';

import { HStack } from '@tale/ui/layout';
import { SkeletonBox } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { Text } from '@tale/ui/text';
import type { ColumnDef } from '@tanstack/react-table';
import type { ComponentType } from 'react';
import { useMemo } from 'react';

import { GoogleDriveIcon } from '@/app/components/icons/google-drive-icon';
import { CopyableTimestamp } from '@/app/components/ui/data-display/copyable-timestamp';
import { DocumentIcon } from '@/app/components/ui/data-display/document-icon';
import { ACTIONS_COLUMN_SIZE } from '@/app/components/ui/data-table/column-builders';
import { Tooltip } from '@/app/components/ui/overlays/tooltip';
import { useFormatNumber } from '@/app/hooks/use-format-number';
import { useT } from '@/lib/i18n/client';
import { formatBytes } from '@/lib/utils/format/number';
import type { DocumentItem } from '@/types/documents';

import { DocumentRecordBadge } from '../components/document-record-badge';
import { DocumentRowActions } from '../components/document-row-actions';
import { RagStatusBadge } from '../components/rag-status-badge';

type DocumentsT = ReturnType<typeof useT<'documents'>>['t'];

interface SourceInfo {
  title: string;
  Icon?: ComponentType<{ className?: string }>;
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
  if (sourceProvider === 'confluence') {
    return {
      title: t('sourceType.confluence'),
    };
  }
  if (sourceProvider === 'google_drive') {
    return {
      title: t('sourceType.googleDrive'),
      Icon: GoogleDriveIcon,
    };
  }
  if (sourceProvider === 'webdav') {
    return {
      title: t('sourceType.webDav'),
    };
  }
  return null;
}

interface DocumentsTableConfigParams {
  onDocumentClick: (item: DocumentItem, e: React.MouseEvent) => void;
  onFolderDeleted: () => void;
  isLoadingTeams: boolean;
  teamMap: Map<string, string>;
  parentFolderTeamId?: string;
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
  parentFolderTeamId,
}: DocumentsTableConfigParams): DocumentsTableConfig {
  const { t: tTables } = useT('tables');
  const { t: tDocuments } = useT('documents');
  const { locale, formatNumber } = useFormatNumber();

  const columns = useMemo<ColumnDef<DocumentItem>[]>(
    () => [
      {
        accessorKey: 'name',
        header: tTables('headers.document'),
        // The document name is the primary, longest column — opt it in as the
        // table's flex column so it absorbs all the container slack while the
        // fixed-width metadata columns keep their declared px. Without this the
        // name shares width equally with every sibling under `table-fixed`,
        // squeezing it so long filenames overflow their cell (and the inner
        // `truncate` can't engage — see the `min-w-0` on the button below).
        meta: { flex: true },
        cell: ({ row }) => {
          const fullPath = row.original.name ?? '';
          const fileName = fullPath.split('/').pop() || fullPath;

          return (
            <HStack gap={3}>
              <DocumentIcon
                className="shrink-0"
                fileName={fileName}
                mimeType={row.original.mimeType}
                isFolder={row.original.type === 'folder'}
              />
              <button
                type="button"
                title={fullPath}
                // `min-w-0` lets this flex item shrink below its content width so
                // the inner `truncate` clips long names with an ellipsis instead
                // of overflowing into the next column.
                className="min-w-0 cursor-pointer text-left"
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
              <DocumentRecordBadge record={row.original.record} />
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
              : formatBytes(row.original.size, locale)}
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
          if (source.Icon) {
            const Icon = source.Icon;
            return (
              <div className="flex justify-center">
                <Tooltip content={source.title}>
                  <span
                    className="inline-flex size-5 items-center justify-center"
                    aria-label={source.title}
                  >
                    <Icon className="size-5" />
                  </span>
                </Tooltip>
              </div>
            );
          }
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
            <HStack gap={2} className="items-center">
              <RagStatusBadge
                status={row.original.ragStatus}
                indexedAt={row.original.ragIndexedAt}
                error={row.original.ragError}
                errorCode={row.original.ragErrorCode}
                documentId={row.original.id}
              />
              {row.original.ragStatus === 'completed' &&
                row.original.ocrApplied === true && (
                  <Text
                    as="span"
                    variant="label-sm"
                    className="text-muted-foreground"
                  >
                    OCR
                  </Text>
                )}
            </HStack>
          ),
      },
      {
        id: 'teams',
        header: tTables('headers.teams'),
        size: 160,
        meta: { skeleton: { type: 'badge' as const } },
        cell: ({ row }) => {
          const teamIds = row.original.teamIds ?? [];
          if (teamIds.length === 0) {
            return (
              <Text as="span" variant="muted" className="text-sm">
                {tDocuments('teamTags.orgWide')}
              </Text>
            );
          }
          if (isLoadingTeams) {
            return (
              <Skeletonize loading className="contents">
                <SkeletonBox>
                  <div className="h-5 w-20" />
                </SkeletonBox>
              </Skeletonize>
            );
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
                  {` +${formatNumber(remaining)}`}
                </span>
              )}
            </Text>
          );
        },
      },
      {
        id: 'uploadedBy',
        header: tTables('headers.uploadedBy'),
        size: 180,
        meta: { className: 'overflow-hidden' },
        cell: ({ row }) => {
          if (row.original.type === 'folder') {
            return (
              <Text as="span" variant="muted">
                —
              </Text>
            );
          }
          const uploadedBy = row.original.createdByName ?? '—';
          return (
            // `w-0 min-w-full` ties the clip box to the `<td>` content width
            // under `table-fixed` — bare `truncate` + `max-w-*` on the text
            // alone can still paint into the Modified column (emails are one
            // unbreakable token). Matches the two-line cell wrapper in
            // `cell-kinds.tsx`. `title` keeps the full value on hover.
            <div className="w-0 min-w-full overflow-hidden">
              <Text
                as="span"
                variant="muted"
                truncate
                title={row.original.createdByName ?? undefined}
                className="block"
              >
                {uploadedBy}
              </Text>
            </div>
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
        size: 208,
        meta: {
          headerLabel: tTables('headers.modified'),
          align: 'right' as const,
          // The timestamp + copy control is nowrap; clip at the cell edge so a
          // long value cannot spill left into Uploaded by (preset `long` also
          // appends a timezone suffix that exceeded the old 192px column).
          className: 'overflow-hidden',
        },
        cell: ({ row }) => (
          <div className="w-0 min-w-full overflow-hidden">
            <CopyableTimestamp
              date={row.original.lastModified}
              // `medium` skips the timezone suffix in the cell; `title` still
              // carries the full localized value + zone for hover/copy.
              preset="medium"
              customFormat="ll LT"
              alignRight
            />
          </div>
        ),
      },
      // `uploadedAt` column dropped — for documents this duplicates
      // `modifiedAt` for the majority of rows (initial upload sets both),
      // and the few cases where they differ are visible on the detail
      // panel. Keeping only `modifiedAt` frees a 192px column for the
      // Teams / RAG status columns to render their badges without
      // overflow.
      {
        id: 'actions',
        size: ACTIONS_COLUMN_SIZE,
        meta: { isAction: true },
        cell: ({ row }) => (
          <HStack justify="end">
            <DocumentRowActions
              documentId={row.original.id}
              itemType={row.original.type}
              name={row.original.name ?? null}
              mimeType={row.original.mimeType}
              extension={row.original.extension}
              syncConfigId={row.original.syncConfigId}
              isDirectlySelected={row.original.isDirectlySelected}
              sourceMode={row.original.sourceMode}
              sourceProvider={row.original.sourceProvider}
              teamIds={row.original.teamIds ?? []}
              onFolderDeleted={onFolderDeleted}
              parentFolderTeamId={parentFolderTeamId}
              ragStatus={row.original.ragStatus}
              record={row.original.record}
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
      parentFolderTeamId,
      locale,
      formatNumber,
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
