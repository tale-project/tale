'use client';

import { DataTable } from '@tale/ui/data-table/data-table';
import type { FilterConfig } from '@tale/ui/data-table/data-table-filters';
import { useDebounce } from '@tale/ui/use-debounce';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { type Row } from '@tanstack/react-table';
import { FileText } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  useTeamDirectory,
  useTeams,
} from '@/app/features/settings/teams/hooks/queries';
import { useListPage } from '@/app/hooks/use-list-page';
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
import {
  filterDocumentResults,
  MY_TEAMS_AUDIENCE,
  ORG_WIDE_AUDIENCE,
} from '../utils/filter-documents';
import { BreadcrumbNavigation } from './breadcrumb-navigation';
import { DocumentPreviewDialog } from './document-preview-dialog';
import { DocumentsActionMenu } from './documents-action-menu';

interface DocumentsTableProps {
  organizationId: string;
  searchQuery?: string;
  currentFolderId?: string;
  docId?: string;
  /**
   * The Teams filter's selection when the page owns it (the URL): team ids
   * and/or the `ORG_WIDE_AUDIENCE` / `MY_TEAMS_AUDIENCE` tokens. Absent, the
   * table keeps the selection itself.
   */
  teamFilter?: string[];
  onTeamFilterChange?: (teamIds: string[]) => void;
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
  teamFilter,
  onTeamFilterChange,
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

  // Names resolve through the org's team DIRECTORY (every team, for any
  // member), so a row shared with a team the viewer is not in still says
  // which; the viewer's OWN teams feed the "My teams" audience filter.
  const { teams: directoryTeams, isLoading: isLoadingTeams } =
    useTeamDirectory();
  const { teams: myTeams } = useTeams();

  const teamMap = useMemo(() => {
    if (!directoryTeams) return new Map<string, string>();
    return new Map(directoryTeams.map((team) => [team.id, team.name]));
  }, [directoryTeams]);
  const myTeamIds = useMemo(
    () => (myTeams ?? []).map((team) => team.id),
    [myTeams],
  );

  const { t: tTables } = useT('tables');

  const [selectedRagStatuses, setSelectedRagStatuses] = useState<string[]>([]);
  const [selectedSources, setSelectedSources] = useState<string[]>([]);
  // The Teams filter lives in the URL when the page owns it (shareable,
  // survives a reload); the table keeps it itself otherwise.
  const [localTeamIds, setLocalTeamIds] = useState<string[]>([]);
  const selectedTeamIds = teamFilter ?? localTeamIds;
  const setSelectedTeamIds = useCallback(
    (teamIds: string[]) => {
      if (onTeamFilterChange) onTeamFilterChange(teamIds);
      else setLocalTeamIds(teamIds);
    },
    [onTeamFilterChange],
  );

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
  const hasActiveQuery =
    debouncedQuery.trim().length > 0 ||
    selectedRagStatuses.length > 0 ||
    selectedSources.length > 0 ||
    selectedTeamIds.length > 0;

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
      // The provider comes from the config, not a guess: a Google Drive
      // folder used to read "OneDrive (synced)". The health rides along so
      // the Source cell can flag a sync that stopped working.
      ...(folder.sync !== undefined && {
        sourceProvider: folder.sync.provider,
        sourceMode: 'auto' as const,
        syncHealth: folder.sync,
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

    // The Teams filter is by AUDIENCE: organization-wide rows, rows any of
    // the viewer's own teams may see, and each team by name (the whole
    // directory — a viewer can filter by a team they are not in and simply
    // see nothing). Only offered once the org has teams.
    if (directoryTeams && directoryTeams.length > 0) {
      configs.push({
        key: 'teams',
        title: tTables('headers.teams'),
        options: [
          {
            value: ORG_WIDE_AUDIENCE,
            label: tDocuments('filter.teams.orgWide'),
          },
          ...(myTeamIds.length > 0
            ? [
                {
                  value: MY_TEAMS_AUDIENCE,
                  label: tDocuments('filter.teams.mine'),
                },
              ]
            : []),
          ...directoryTeams.map((team) => ({
            value: team.id,
            label: team.name,
          })),
        ],
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
    setSelectedTeamIds,
    directoryTeams,
    myTeamIds,
  ]);

  const handleClearFilters = useCallback(() => {
    setSelectedRagStatuses([]);
    setSelectedSources([]);
    setSelectedTeamIds([]);
  }, [setSelectedTeamIds]);

  const filteredResults = useMemo(
    () =>
      filterDocumentResults(
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Convex paginated query results match DocumentItem shape
        paginatedResult.results as DocumentItem[],
        folderRows,
        {
          selectedTeamIds,
          myTeamIds,
          selectedRagStatuses,
          selectedSources,
          searchQuery: debouncedQuery,
          ragStatusFilterMap,
        },
      ),
    [
      paginatedResult.results,
      myTeamIds,
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

  // Where focus goes when the preview closes if its opener is gone: the row
  // menu's trigger for a preview opened from the menu's View, whose item
  // unmounts; nothing for a row or name click, which keep their opener.
  const previewOpenerRef = useRef<HTMLElement | null>(null);

  const openPreview = useCallback(
    (id: string, opener: HTMLElement | null = null) => {
      previewOpenerRef.current = opener;
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

  const { columns, pageSize, searchPlaceholder } = useDocumentsTableConfig({
    onDocumentClick: handleDocumentClick,
    onDocumentView: openPreview,
    currentFolderId,
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
        stickyLayout
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
        restoreFocusRef={previewOpenerRef}
      />
    </>
  );
}
