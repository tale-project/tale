'use client';

import { useState, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { type Preloaded } from 'convex/react';
import {
  useCreateAutomation,
  useDuplicateAutomation,
  useDeleteAutomation,
} from '../hooks';
import {
  Copy,
  MoreVertical,
  Plus,
  Sparkles,
  Trash2,
  Workflow,
} from 'lucide-react';
import { type ColumnDef, type Row } from '@tanstack/react-table';
import { api } from '@/convex/_generated/api';
import { Doc } from '@/convex/_generated/dataModel';
import { DataTable, DataTableEmptyState } from '@/components/ui/data-table';
import { DataTableFilters } from '@/components/ui/data-table/data-table-filters';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toast } from '@/hooks/use-toast';
import { useDateFormat } from '@/hooks/use-date-format';
import CreateAutomationDialog from './create-automation-dialog';
import DeleteAutomationDialog from './delete-automation-dialog';
import { useT } from '@/lib/i18n';
import { useUrlFilters } from '@/hooks/use-url-filters';
import { useOffsetPaginatedQuery } from '@/hooks/use-offset-paginated-query';
import { automationFilterDefinitions } from '../filter-definitions';

interface AutomationsTableProps {
  organizationId: string;
  preloadedAutomations: Preloaded<typeof api.wf_definitions.listAutomations>;
}

export default function AutomationsTable({
  organizationId,
  preloadedAutomations,
}: AutomationsTableProps) {
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [automationToDelete, setAutomationToDelete] =
    useState<Doc<'wfDefinitions'> | null>(null);

  const router = useRouter();
  const { formatDate } = useDateFormat();
  const { t: tAutomations } = useT('automations');
  const { t: tTables } = useT('tables');
  const { t: tToast } = useT('toast');
  const { t: tCommon } = useT('common');
  const { t: tEmpty } = useT('emptyStates');

  // Use unified URL filters hook with sorting
  const {
    filters: filterValues,
    sorting,
    setSorting,
    pagination,
    setFilter,
    setPage,
    setPageSize,
    clearAll,
    hasActiveFilters,
    isPending,
  } = useUrlFilters({
    filters: automationFilterDefinitions,
    pagination: { defaultPageSize: 10 },
    sorting: { defaultSort: '_creationTime', defaultDesc: true },
  });

  // Use paginated query with SSR + real-time updates
  const { data, isLoading } = useOffsetPaginatedQuery({
    query: api.wf_definitions.listAutomations,
    preloadedData: preloadedAutomations,
    organizationId,
    filters: {
      filters: filterValues,
      sorting,
      pagination,
      setFilter,
      setSorting,
      setPage,
      setPageSize,
      clearAll,
      hasActiveFilters,
      isPending,
      definitions: automationFilterDefinitions,
    },
    transformFilters: (f) => ({
      searchTerm: f.query || undefined,
      status: f.status.length > 0 ? f.status : undefined,
      sortField: sorting[0]?.id,
      sortOrder: sorting[0] ? (sorting[0].desc ? 'desc' as const : 'asc' as const) : undefined,
    }),
  });

  const automations = data?.items ?? [];
  const emptyAutomations = automations.length === 0 && !hasActiveFilters;

  const createAutomation = useCreateAutomation();
  const duplicateAutomation = useDuplicateAutomation();
  const deleteAutomation = useDeleteAutomation();

  const handleCreateAutomation = () => {
    setCreateDialogOpen(true);
  };

  const handleDuplicateAutomation = useCallback(
    async (workflow: Doc<'wfDefinitions'>) => {
      try {
        await duplicateAutomation({
          wfDefinitionId: workflow._id,
        });
        toast({
          title: tToast('success.automationDuplicated'),
          variant: 'success',
        });
      } catch (error) {
        console.error('Failed to duplicate automation:', error);
        toast({
          title: `${tToast('error.automationDuplicateFailed')}: ${error instanceof Error ? error.message : tTables('cells.unknown')}`,
          variant: 'destructive',
        });
      }
    },
    [duplicateAutomation, tToast, tTables],
  );

  const handleDeleteClick = useCallback((workflow: Doc<'wfDefinitions'>) => {
    setAutomationToDelete(workflow);
    setDeleteDialogOpen(true);
  }, []);

  const handleDeleteConfirm = async () => {
    if (!automationToDelete) return;

    try {
      await deleteAutomation({
        wfDefinitionId: automationToDelete._id,
      });
      setDeleteDialogOpen(false);
      setAutomationToDelete(null);
    } catch (error) {
      console.error('Failed to delete automation:', error);
      toast({
        title: `${tToast('error.automationDeleteFailed')}: ${error instanceof Error ? error.message : tTables('cells.unknown')}`,
        variant: 'destructive',
      });
    }
  };

  const handleRowClick = (row: Row<Doc<'wfDefinitions'>>) => {
    router.push(`/dashboard/${organizationId}/automations/${row.original._id}`);
  };

  // Helper function to get status badge color
  const getStatusBadge = useCallback(
    (status: string) => {
      return (
        <Badge dot variant={status === 'active' ? 'green' : 'outline'}>
          {status === 'active'
            ? tCommon('status.published')
            : tCommon('status.draft')}
        </Badge>
      );
    },
    [tCommon],
  );

  // Define columns using TanStack Table
  const columns = useMemo<ColumnDef<Doc<'wfDefinitions'>>[]>(
    () => [
      {
        accessorKey: 'name',
        header: tTables('headers.automation'),
        size: 328,
        cell: ({ row }) => (
          <span className="text-sm font-medium text-foreground truncate px-2">
            {row.original.name}
          </span>
        ),
      },
      {
        accessorKey: 'status',
        header: tTables('headers.status'),
        size: 140,
        cell: ({ row }) => getStatusBadge(row.original.status),
      },
      {
        accessorKey: 'version',
        header: tTables('headers.version'),
        size: 100,
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground">
            {row.original.version}
          </span>
        ),
      },
      {
        accessorKey: '_creationTime',
        header: () => (
          <span className="text-right w-full block">
            {tTables('headers.created')}
          </span>
        ),
        size: 140,
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground text-right block">
            {formatDate(new Date(row.original._creationTime), 'short')}
          </span>
        ),
      },
      {
        id: 'actions',
        size: 80,
        cell: ({ row }) => (
          <div className="flex justify-end">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={(e) => e.stopPropagation()}
                >
                  <MoreVertical className="size-4 text-foreground" />
                  <span className="sr-only">{tCommon('actions.openMenu')}</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-40">
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDuplicateAutomation(row.original);
                  }}
                >
                  <Copy className="size-4 mr-2 text-muted-foreground p-0.5" />
                  <span className="text-sm font-medium text-muted-foreground">
                    {tCommon('actions.duplicate')}
                  </span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDeleteClick(row.original);
                  }}
                  className="text-destructive focus:text-destructive"
                >
                  <Trash2 className="size-4 mr-2" />
                  <span className="text-sm font-medium">
                    {tCommon('actions.delete')}
                  </span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ),
      },
    ],
    [
      formatDate,
      getStatusBadge,
      handleDuplicateAutomation,
      handleDeleteClick,
      tTables,
      tCommon,
    ],
  );

  // Build filter configs for DataTableFilters component
  const filterConfigs = useMemo(
    () => [
      {
        key: 'status',
        title: tTables('headers.status'),
        options: [
          { value: 'active', label: 'Published' },
          { value: 'draft', label: 'Draft' },
        ],
        selectedValues: filterValues.status,
        onChange: (values: string[]) => setFilter('status', values),
      },
    ],
    [filterValues, setFilter, tTables],
  );

  const createButton = (
    <Button onClick={handleCreateAutomation} className="gap-2">
      <Plus className="size-4" />
      {tAutomations('createButton')}
    </Button>
  );

  // Show empty state when no automations and no filters
  if (emptyAutomations) {
    return (
      <>
        <DataTableEmptyState
          icon={Workflow}
          title={tEmpty('automations.title')}
          description={tEmpty('automations.description')}
          action={
            <Button onClick={handleCreateAutomation}>
              <Sparkles className="size-4 mr-2" />
              {tAutomations('createWithAI')}
            </Button>
          }
        />
        <CreateAutomationDialog
          open={createDialogOpen}
          onOpenChange={setCreateDialogOpen}
          organizationId={organizationId}
        />
      </>
    );
  }

  return (
    <>
      <DataTable
        columns={columns}
        data={automations}
        getRowId={(row) => row._id}
        onRowClick={handleRowClick}
        isLoading={isLoading}
        stickyLayout
        enableSorting
        initialSorting={sorting}
        onSortingChange={setSorting}
        header={
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <DataTableFilters
              search={{
                value: filterValues.query,
                onChange: (value) => setFilter('query', value),
                placeholder: tAutomations('searchPlaceholder'),
              }}
              filters={filterConfigs}
              isLoading={isPending}
              onClearAll={clearAll}
            />
            {createButton}
          </div>
        }
        emptyState={{
          title: tCommon('search.noResults'),
          description: tCommon('search.tryAdjusting'),
          isFiltered: true,
        }}
        pagination={{
          total: data?.total ?? 0,
          pageSize: pagination.pageSize,
          totalPages: data?.totalPages ?? 1,
          hasNextPage: data?.hasNextPage ?? false,
          hasPreviousPage: data?.hasPreviousPage ?? false,
          onPageChange: setPage,
          onPageSizeChange: setPageSize,
          clientSide: false,
        }}
        currentPage={pagination.page}
      />
      <CreateAutomationDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        organizationId={organizationId}
      />
      <DeleteAutomationDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        onConfirm={handleDeleteConfirm}
        workflowName={automationToDelete?.name || ''}
      />
    </>
  );
}
