'use client';

import { useNavigate } from '@tanstack/react-router';
import { type Row } from '@tanstack/react-table';
import { ClipboardList } from 'lucide-react';
import { useMemo, useState, useCallback } from 'react';

import type { FilterConfig } from '@/app/components/ui/data-table/data-table-filters';
import type { DocumentItem, RagStatus } from '@/types/documents';

import { DataTable } from '@/app/components/ui/data-table/data-table';
import { useTeams } from '@/app/features/settings/teams/hooks/queries';
import { useDebounce } from '@/app/hooks/use-debounce';
import { useListPage } from '@/app/hooks/use-list-page';
import { useTeamFilter } from '@/app/hooks/use-team-filter';
import { useT } from '@/lib/i18n/client';
import { filterByTextSearch } from '@/lib/utils/filtering';

import {
  useApproxDocumentCount,
  useFolders,
  useListDocumentsPaginated,
} from '../hooks/queries';
import { useDocumentsTableConfig } from '../hooks/use-documents-table-config';
import { BreadcrumbNavigation } from './breadcrumb-navigation';
import { DocumentPreviewDialog } from './document-preview-dialog';
import { DocumentsActionMenu } from './documents-action-menu';

interface DocumentsTableProps {
  organizationId: string;
  searchQuery?: string;
  currentFolderId?: string;
  docId?: string;
  hasMicrosoftAccount?: boolean;
}

export function DocumentsTable({
  organizationId,
  searchQuery,
  currentFolderId,
  docId,
  hasMicrosoftAccount = false,
}: DocumentsTableProps) {
  const navigate = useNavigate();
  const { t: tDocuments } = useT('documents');

  const { data: docCount } = useApproxDocumentCount(organizationId);
  const [query, setQuery] = useState(searchQuery ?? '');
  const debouncedQuery = useDebounce(query, 300);

  const { teams, isLoading: isLoadingTeams } = useTeams();

  const teamMap = useMemo(() => {
    if (!teams) return new Map<string, string>();
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

  const { data: folders } = useFolders(organizationId, currentFolderId);

  const folderRows = useMemo<DocumentItem[]>(() => {
    if (!folders) return [];
    return folders.map((folder) => ({
      id: folder._id,
      name: folder.name,
      type: 'folder' as const,
      folderId: folder._id,
      lastModified: folder._creationTime,
    }));
  }, [folders]);

  const ragStatusFilterMap: Record<string, RagStatus[]> = useMemo(
    () => ({
      indexed: ['completed'],
      not_indexed: ['not_indexed'],
      indexing: ['queued', 'running'],
      failed: ['failed'],
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
        options: teams.map((team) => ({
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

  const filteredResults = useMemo(() => {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Convex paginated query results match DocumentItem shape
    let filtered = paginatedResult.results as DocumentItem[];
    if (selectedTeamId) {
      filtered = filtered.filter(
        (doc) => !doc.teamId || doc.teamId === selectedTeamId,
      );
    }
    if (selectedRagStatuses.length > 0) {
      const allowedStatuses = new Set(
        selectedRagStatuses.flatMap((key) => ragStatusFilterMap[key] ?? []),
      );
      filtered = filtered.filter((doc) => {
        const status = doc.ragStatus ?? 'not_indexed';
        return allowedStatuses.has(status);
      });
    }
    if (selectedSources.length > 0) {
      const sourceSet = new Set(selectedSources);
      filtered = filtered.filter(
        (doc) => doc.sourceProvider && sourceSet.has(doc.sourceProvider),
      );
    }
    if (selectedTeamIds.length > 0) {
      const teamIdSet = new Set(selectedTeamIds);
      filtered = filtered.filter(
        (doc) => doc.teamId && teamIdSet.has(doc.teamId),
      );
    }
    if (debouncedQuery) {
      const filteredFolders = filterByTextSearch(folderRows, debouncedQuery, [
        'name',
      ]);
      filtered = filterByTextSearch(filtered, debouncedQuery, ['name']);
      return [...filteredFolders, ...filtered];
    }
    return [...folderRows, ...filtered];
  }, [
    paginatedResult.results,
    selectedTeamId,
    selectedRagStatuses,
    selectedSources,
    selectedTeamIds,
    ragStatusFilterMap,
    debouncedQuery,
    folderRows,
  ]);

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
        onRowClick={handleRowClick}
        rowClassName={getRowClassName}
        stickyLayout={stickyLayout}
        actionMenu={
          <DocumentsActionMenu
            organizationId={organizationId}
            currentFolderId={currentFolderId}
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
        documentId={docId ?? undefined}
        fileName={previewFileName ?? undefined}
      />
    </>
  );
}
