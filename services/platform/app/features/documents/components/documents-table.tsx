'use client';

import { useNavigate } from '@tanstack/react-router';
import { type Row } from '@tanstack/react-table';
import { ClipboardList } from 'lucide-react';
import { useMemo, useState, useCallback } from 'react';

import type { DocumentItem } from '@/types/documents';

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

  const filteredResults = useMemo(() => {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Convex paginated query results match DocumentItem shape
    let filtered = paginatedResult.results as DocumentItem[];
    if (selectedTeamId) {
      filtered = filtered.filter(
        (doc) => !doc.teamId || doc.teamId === selectedTeamId,
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
  }, [paginatedResult.results, selectedTeamId, debouncedQuery, folderRows]);

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
