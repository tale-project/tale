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
  useListDocumentsPaginated,
} from '../hooks/queries';
import { useDocumentsTableConfig } from '../hooks/use-documents-table-config';
import { BreadcrumbNavigation } from './breadcrumb-navigation';
import { DocumentPreviewDialog } from './document-preview-dialog';
import { DocumentsActionMenu } from './documents-action-menu';

interface DocumentsTableProps {
  organizationId: string;
  searchQuery?: string;
  currentFolderPath?: string;
  docId?: string;
  hasMicrosoftAccount?: boolean;
}

export function DocumentsTable({
  organizationId,
  searchQuery,
  currentFolderPath,
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
    initialNumItems: 20,
  });

  const filteredResults = useMemo(() => {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Convex paginated query results match DocumentItem shape
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

  const { columns, stickyLayout, pageSize, searchPlaceholder } =
    useDocumentsTableConfig({
      onDocumentClick: handleDocumentClick,
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
            folderPath: currentFolderPath,
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
      {currentFolderPath && (
        <BreadcrumbNavigation currentFolderPath={currentFolderPath} />
      )}

      <DataTable
        columns={columns}
        onRowClick={handleRowClick}
        rowClassName={getRowClassName}
        stickyLayout={stickyLayout}
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
