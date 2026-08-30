'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { type Row } from '@tanstack/react-table';
import { FileText } from 'lucide-react';
import { useEffect, useMemo, useState, useCallback } from 'react';

import { DataTable } from '@/app/components/ui/data-table/data-table';
import type { FilterConfig } from '@/app/components/ui/data-table/data-table-filters';
import { useTeams } from '@/app/features/settings/teams/hooks/queries';
import { useDebounce } from '@/app/hooks/use-debounce';
import { useListPage } from '@/app/hooks/use-list-page';
import { useTeamFilter } from '@/app/hooks/use-team-filter';
import { prefetchAdaptedQuery } from '@/app/lib/backend/prefetch';
import { useT } from '@/lib/i18n/client';
import { scopeTeamIds } from '@/lib/knowledge/types';
import type { DocumentItem, RagStatus } from '@/types/documents';

import {
  useApproxDocumentCount,
  useFolder,
  useFolders,
  useListDocumentsPaginated,
} from '../hooks/queries';
import { useDocumentsTableConfig } from '../hooks/use-documents-table-config';
import { filterDocumentResults } from '../utils/filter-documents';
import { BreadcrumbNavigation } from './breadcrumb-navigation';
import { DocumentPreviewDialog } from './document-preview-dialog';
import { DocumentsActionMenu } from './documents-action-menu';

interface DocumentsTableProps {
  organizationId: string;
  searchQuery?: string;
  currentFolderId?: string;
  docId?: string;
  /** Controlled Microsoft 365 picker (set after cloud-import OAuth return). */
  oneDriveOpen?: boolean;
  onOneDriveOpenChange?: (open: boolean) => void;
  /** Controlled Google Drive picker (set after cloud-import OAuth return). */
  googleDriveOpen?: boolean;
  onGoogleDriveOpenChange?: (open: boolean) => void;
}

export function DocumentsTable({
  organizationId,
  searchQuery,
  currentFolderId,
  docId,
  oneDriveOpen,
  onOneDriveOpenChange,
  googleDriveOpen,
  onGoogleDriveOpenChange,
}: DocumentsTableProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { t: tDocuments } = useT('documents');

  const { data: docCount } = useApproxDocumentCount(organizationId);
  const [query, setQuery] = useState(searchQuery ?? '');
  const debouncedQuery = useDebounce(query, 300);

  const { teams, isLoading: isLoadingTeams } = useTeams();

  const teamMap = useMemo(() => {
    if (!teams) return new Map();
    return new Map(
      teams.map((team: { id: string; name: string }) => [team.id, team.name]),
    );
  }, [teams]);

  const { selectedTeamId } = useTeamFilter();
  const { t: tTables } = useT('tables');

  const [selectedRagStatuses, setSelectedRagStatuses] = useState<string[]>([]);
  const [selectedSources, setSelectedSources] = useState<string[]>([]);
  const [selectedTeamIds, setSelectedTeamIds] = useState<string[]>([]);

  const paginatedResult = useListDocumentsPaginated({
    organizationId,
    folderId: currentFolderId,
    initialNumItems: 20,
  });

  // Search and filters run client-side over `paginatedResult.results`, which
  // only holds loaded pages. The default infinite-scroll list has nothing to
  // scroll while a query is active, so further pages never load and any match
  // beyond the first page reads as "no results". Eagerly pull every page while
  // a search/filter is active so the client-side filter sees the full set.
  // Includes `selectedTeamId` from the page-level team filter context —
  // filterDocumentResults reads it too, so omitting it from this predicate
  // means a context-only filter (no search, no local filters) still showed
  // only the first page (round-3 P2 R19-P2-a).
  const hasActiveQuery =
    debouncedQuery.trim().length > 0 ||
    selectedRagStatuses.length > 0 ||
    selectedSources.length > 0 ||
    selectedTeamIds.length > 0 ||
    selectedTeamId != null;

  const { status: pageStatus, loadMore: loadMorePage } = paginatedResult;
  useEffect(() => {
    if (hasActiveQuery && pageStatus === 'CanLoadMore') {
      loadMorePage(200);
    }
  }, [hasActiveQuery, pageStatus, loadMorePage]);

  const { data: currentFolder } = useFolder(currentFolderId);
  const parentFolderTeamId = currentFolder?.teamId ?? undefined;

  const { data: folders } = useFolders(organizationId, currentFolderId);

  const folderRows = useMemo<DocumentItem[]>(() => {
    if (!folders) return [];
    return folders.map((folder: (typeof folders)[number]) => ({
      id: folder._id,
      name: folder.name,
      type: 'folder' as const,
      folderId: folder._id,
      lastModified: folder._creationTime,
      // Through the shared helper rather than a second copy of its precedence
      // — a folder carries the same two mutually exclusive scopes as a document
      // (`folders/schema.ts`), and the scope column classifies both the same way.
      teamIds: [...scopeTeamIds(folder)],
      projectId: folder.projectId ?? null,
      syncConfigId: folder.syncConfigId,
      ...(folder.syncConfigId && {
        sourceProvider: 'onedrive',
        sourceMode: 'auto' as const,
      }),
    }));
  }, [folders]);

  const ragStatusFilterMap: Record<string, RagStatus[]> = useMemo(
    () => ({
      indexed: ['completed'],
      not_indexed: ['not_indexed'],
      indexing: ['queued', 'running'],
      failed: ['failed'],
      unsupported: ['unsupported'],
      stale: ['stale'],
    }),
    [],
  );

  const filterConfigs = useMemo<FilterConfig[]>(() => {
    const configs: FilterConfig[] = [
      {
        key: 'ragStatus',
        title: tTables('headers.ragStatus'),
        options: [
          { value: 'indexed', label: tDocuments('filter.ragStatus.indexed') },
          {
            value: 'not_indexed',
            label: tDocuments('filter.ragStatus.notIndexed'),
          },
          {
            value: 'indexing',
            label: tDocuments('filter.ragStatus.indexing'),
          },
          { value: 'failed', label: tDocuments('filter.ragStatus.failed') },
          {
            value: 'unsupported',
            label: tDocuments('filter.ragStatus.unsupported'),
          },
          {
            value: 'stale',
            label: tDocuments('filter.ragStatus.needsReindex'),
          },
        ],
        selectedValues: selectedRagStatuses,
        onChange: setSelectedRagStatuses,
        multiSelect: true,
      },
      {
        key: 'source',
        title: tTables('headers.source'),
        options: [
          { value: 'upload', label: tDocuments('filter.source.upload') },
          { value: 'onedrive', label: tDocuments('filter.source.oneDrive') },
          {
            value: 'sharepoint',
            label: tDocuments('filter.source.sharePoint'),
          },
        ],
        selectedValues: selectedSources,
        onChange: setSelectedSources,
        multiSelect: true,
      },
    ];

    if (teams && teams.length > 0) {
      configs.push({
        key: 'teams',
        title: tTables('headers.teams'),
        options: teams.map((team: { id: string; name: string }) => ({
          value: team.id,
          label: team.name,
        })),
        selectedValues: selectedTeamIds,
        onChange: setSelectedTeamIds,
        multiSelect: true,
      });
    }

    return configs;
  }, [
    tTables,
    tDocuments,
    selectedRagStatuses,
    selectedSources,
    selectedTeamIds,
    teams,
  ]);

  const handleClearFilters = useCallback(() => {
    setSelectedRagStatuses([]);
    setSelectedSources([]);
    setSelectedTeamIds([]);
  }, []);

  const filteredResults = useMemo(
    () =>
      filterDocumentResults(
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Convex paginated query results match DocumentItem shape
        paginatedResult.results as DocumentItem[],
        folderRows,
        {
          selectedTeamId,
          selectedTeamIds,
          selectedRagStatuses,
          selectedSources,
          searchQuery: debouncedQuery,
          ragStatusFilterMap,
        },
      ),
    [
      paginatedResult.results,
      selectedTeamId,
      selectedRagStatuses,
      selectedSources,
      selectedTeamIds,
      ragStatusFilterMap,
      debouncedQuery,
      folderRows,
    ],
  );

  const previewDocument = useMemo(() => {
    if (!docId || !filteredResults.length) return null;
    return filteredResults.find((item) => item.id === docId) ?? null;
  }, [filteredResults, docId]);

  const previewFileName = previewDocument?.name ?? null;

  const getRowClassName = useCallback(
    (row: Row<DocumentItem>) =>
      row.original.type === 'folder' ? 'cursor-pointer' : '',
    [],
  );

  const navigateToFolder = useCallback(
    (folderId: string | undefined) => {
      void navigate({
        to: '/dashboard/$id/documents',
        params: { id: organizationId },
        search: {
          query: query.trim() || undefined,
          folderId,
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
          folderId: currentFolderId,
          doc: id,
        },
      });
    },
    [navigate, organizationId, query, currentFolderId],
  );

  const handleRowClick = useCallback(
    (row: Row<DocumentItem>) => {
      if (row.original.type === 'folder' && row.original.folderId) {
        navigateToFolder(row.original.folderId);
      } else if (row.original.type === 'file') {
        openPreview(row.original.id);
      }
    },
    [navigateToFolder, openPreview],
  );

  const handleRowMouseEnter = useCallback(
    (row: Row<DocumentItem>) => {
      // Warm the preview's point query on hover (cheap single-doc read) so the
      // preview dialog opens without a loading flash on click.
      if (row.original.type !== 'file') return;
      prefetchAdaptedQuery(queryClient, 'documents/queries:getDocumentById', {
        documentId: row.original.id,
        organizationId,
      });
    },
    [queryClient, organizationId],
  );

  const closePreview = useCallback(() => {
    void navigate({
      to: '/dashboard/$id/documents',
      params: { id: organizationId },
      search: {
        query: query.trim() || undefined,
        folderId: currentFolderId,
      },
    });
  }, [navigate, organizationId, query, currentFolderId]);

  const handleFolderDeleted = useCallback(
    () => navigateToFolder(undefined),
    [navigateToFolder],
  );

  const handleDocumentClick = useCallback(
    (item: DocumentItem, e: React.MouseEvent) => {
      e.stopPropagation();
      if (item.type === 'file') {
        openPreview(item.id);
      }
      if (item.type === 'folder' && item.folderId) {
        navigateToFolder(item.folderId);
      }
    },
    [navigateToFolder, openPreview],
  );

  const { columns, stickyLayout, pageSize, searchPlaceholder } =
    useDocumentsTableConfig({
      onDocumentClick: handleDocumentClick,
      onFolderDeleted: handleFolderDeleted,
      isLoadingTeams,
      teamMap,
      parentFolderTeamId,
    });

  const list = useListPage({
    dataSource: {
      type: 'paginated',
      results: filteredResults,
      status: paginatedResult.status,
      loadMore: paginatedResult.loadMore,
      isLoading: paginatedResult.isLoading,
    },
    pageSize,
    search: {
      value: query,
      onChange: (value: string) => {
        setQuery(value);
        void navigate({
          to: '/dashboard/$id/documents',
          params: { id: organizationId },
          search: {
            query: value.trim() || undefined,
            folderId: currentFolderId,
            doc: docId,
          },
        });
      },
      placeholder: searchPlaceholder,
    },
    filters: {
      configs: filterConfigs,
      onClear: handleClearFilters,
    },
    getRowId: (row) => row.id,
    approxRowCount: docCount,
    entityLabel: {
      one: tDocuments('entityLabelOne'),
      other: tDocuments('entityLabel'),
    },
  });

  return (
    <>
      {currentFolderId && (
        <BreadcrumbNavigation
          folderId={currentFolderId}
          onNavigate={navigateToFolder}
        />
      )}

      <DataTable
        columns={columns}
        caption={tDocuments('tableCaption')}
        onRowClick={handleRowClick}
        onRowMouseEnter={handleRowMouseEnter}
        rowClassName={getRowClassName}
        stickyLayout={stickyLayout}
        actionMenu={
          <DocumentsActionMenu
            organizationId={organizationId}
            currentFolderId={currentFolderId}
            parentFolderTeamId={parentFolderTeamId}
            oneDriveOpen={oneDriveOpen}
            onOneDriveOpenChange={onOneDriveOpenChange}
            googleDriveOpen={googleDriveOpen}
            onGoogleDriveOpenChange={onGoogleDriveOpenChange}
          />
        }
        emptyState={{
          icon: FileText,
          title: tDocuments('emptyState.title'),
          description: tDocuments('emptyState.description'),
          // The documents table sits directly under the page `h1` ("Knowledge")
          // with no intervening section heading, so the empty-state title is an
          // `h2` — otherwise the heading outline skips `h1`→`h3`.
          headingLevel: 2,
        }}
        {...list.tableProps}
      />

      <DocumentPreviewDialog
        open={!!docId}
        onOpenChange={(open) => !open && closePreview()}
        documentId={docId ?? undefined}
        fileName={previewFileName ?? undefined}
      />
    </>
  );
}
