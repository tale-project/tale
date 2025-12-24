'use client';

import { useState, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery } from 'convex/react';
import { useDebounce } from '@/hooks/use-debounce';
import {
  Copy,
  MoreVertical,
  Plus,
  Search,
  Sparkles,
  Trash2,
  Workflow,
} from 'lucide-react';
import { type ColumnDef, type Row } from '@tanstack/react-table';
import { api } from '@/convex/_generated/api';
import { Doc } from '@/convex/_generated/dataModel';
import { DataTable, DataTableEmptyState } from '@/components/ui/data-table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
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

interface AutomationsTableProps {
  organizationId: string;
}

export default function AutomationsTable({
  organizationId,
}: AutomationsTableProps) {
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [automationToDelete, setAutomationToDelete] =
    useState<Doc<'wfDefinitions'> | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const router = useRouter();
  const { formatDate } = useDateFormat();
  const { t: tAutomations } = useT('automations');
  const { t: tTables } = useT('tables');
  const { t: tToast } = useT('toast');
  const { t: tCommon } = useT('common');
  const { t: tEmpty } = useT('emptyStates');

  // Debounce search query for server-side filtering
  const debouncedSearch = useDebounce(searchQuery, 300);

  // Fetch automations with server-side search filtering
  const automationsData = useQuery(
    api.wf_definitions.listWorkflowsWithBestVersionPublic,
    {
      organizationId,
      search: debouncedSearch || undefined,
    },
  );

  const automations = automationsData ?? [];

  const createAutomation = useMutation(
    api.wf_definitions.createWorkflowWithStepsPublic,
  );

  const duplicateAutomation = useMutation(
    api.wf_definitions.duplicateWorkflowPublic,
  );

  // Delete automation with optimistic update for immediate UI feedback
  const deleteAutomation = useMutation(
    api.wf_definitions.deleteWorkflowPublic,
  ).withOptimisticUpdate((localStore, args) => {
    // Get the current query result
    const currentAutomations = localStore.getQuery(
      api.wf_definitions.listWorkflowsWithBestVersionPublic,
      {
        organizationId,
        search: debouncedSearch || undefined,
      },
    );

    if (currentAutomations !== undefined) {
      // Remove the deleted automation from the list immediately
      const updatedAutomations = currentAutomations.filter(
        (automation) => automation._id !== args.wfDefinitionId,
      );
      localStore.setQuery(
        api.wf_definitions.listWorkflowsWithBestVersionPublic,
        {
          organizationId,
          search: debouncedSearch || undefined,
        },
        updatedAutomations,
      );
    }
  });

  const handleCreateAutomation = () => {
    setCreateDialogOpen(true);
  };

  const _handleCreateAutomationSubmit = async (data: {
    name: string;
    description?: string;
    config?: Record<string, unknown>;
  }) => {
    try {
      await createAutomation({
        organizationId,
        workflowConfig: {
          name: data.name,
          description: data.description,
          config: data.config || {},
        },
        stepsConfig: [],
      });
      toast({
        title: tToast('success.automationCreated'),
        variant: 'success',
      });
    } catch (error) {
      console.error('Failed to create automation:', error);
      toast({
        title: `${tToast('error.automationCreateFailed')}: ${error instanceof Error ? error.message : tTables('cells.unknown')}`,
        variant: 'destructive',
      });
    }
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
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={(e) => e.stopPropagation()}
              >
                <MoreVertical className="size-4 text-foreground" />
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

  const emptyAutomations = automations.length === 0 && !debouncedSearch;

  const createButton = (
    <Button onClick={handleCreateAutomation} className="gap-2">
      <Plus className="size-4" />
      {tAutomations('createButton')}
    </Button>
  );

  return (
    <>
      {emptyAutomations ? (
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
      ) : (
        <DataTable
          columns={columns}
          data={automations}
          getRowId={(row) => row._id}
          onRowClick={handleRowClick}
          header={
            <div className="flex items-center justify-between">
              <div className="relative w-full max-w-[18.75rem]">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground size-4" />
                <Input
                  placeholder={tAutomations('searchPlaceholder')}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                />
              </div>
              {createButton}
            </div>
          }
          emptyState={{
            title: tCommon('search.noResults'),
            description: tCommon('search.tryAdjusting'),
            isFiltered: true,
          }}
        />
      )}
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
