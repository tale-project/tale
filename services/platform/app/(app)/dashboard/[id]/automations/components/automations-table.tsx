'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Copy,
  MoreVertical,
  Plus,
  Search,
  Sparkles,
  Trash2,
  Workflow,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import CreateAutomationDialog from './create-automation-dialog';
import DeleteAutomationDialog from './delete-automation-dialog';
import { useMutation, useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { toast } from '@/hooks/use-toast';
import { Doc } from '@/convex/_generated/dataModel';
import { useDateFormat } from '@/hooks/use-date-format';
import { useDebounce } from 'ahooks';

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

  // Debounce search query for server-side filtering
  const debouncedSearch = useDebounce(searchQuery, { wait: 300 });

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

  const handleCreateAutomationSubmit = async (data: {
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
        title: 'Automation created successfully',
        variant: 'success',
      });
    } catch (error) {
      console.error('Failed to create automation:', error);
      toast({
        title: `Failed to create automation: ${error instanceof Error ? error.message : 'Unknown error'}`,
        variant: 'destructive',
      });
    }
  };

  const handleDuplicateAutomation = async (workflow: Doc<'wfDefinitions'>) => {
    try {
      await duplicateAutomation({
        wfDefinitionId: workflow._id,
      });
      toast({
        title: 'Automation duplicated successfully',
        variant: 'success',
      });
    } catch (error) {
      console.error('Failed to duplicate automation:', error);
      toast({
        title: `Failed to duplicate automation: ${error instanceof Error ? error.message : 'Unknown error'}`,
        variant: 'destructive',
      });
    }
  };

  const handleDeleteClick = (workflow: Doc<'wfDefinitions'>) => {
    setAutomationToDelete(workflow);
    setDeleteDialogOpen(true);
  };

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
        title: `Failed to delete automation: ${error instanceof Error ? error.message : 'Unknown error'}`,
        variant: 'destructive',
      });
    }
  };

  const handleRowClick = (workflow: Doc<'wfDefinitions'>) => {
    router.push(`/dashboard/${organizationId}/automations/${workflow._id}`);
  };

  // Helper function to get status badge color
  const getStatusBadge = (status: string) => {
    return (
      <Badge dot variant={status === 'active' ? 'green' : 'outline'}>
        {status === 'active' ? 'Published' : 'Draft'}
      </Badge>
    );
  };

  // Search filtering is now done server-side in the Convex query

  return (
    <div className="flex flex-col flex-1 px-4 py-6">
      {automations.length > 0 && (
        <div className="flex items-center justify-between mb-4">
          {/* Search Bar */}
          <div className="relative w-full max-w-[18.75rem]">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground size-4" />
            <Input
              placeholder="Search automations..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
          {/* Create Button */}
          <Button onClick={handleCreateAutomation} className="gap-2">
            <Plus className="size-4" />
            Create automation
          </Button>
        </div>
      )}

      {automations.length === 0 && !debouncedSearch ? (
        /* Empty State - no automations at all */
        <div className="flex items-center justify-center flex-[1_1_0] ring-1 ring-border rounded-xl p-4">
          <div className="flex flex-col items-center space-y-4 text-center max-w-md">
            <Workflow className="size-6 text-muted-foreground" />
            <div className="space-y-2">
              <h2 className="text-lg font-semibold text-foreground">
                No automations yet
              </h2>
              <p className="text-sm text-muted-foreground">
                Describe your workflow and let your AI automate it
              </p>
            </div>
            <Button onClick={handleCreateAutomation}>
              <Sparkles className="size-4 mr-2" />
              Create automation with AI
            </Button>
          </div>
        </div>
      ) : automations.length === 0 ? (
        /* No Search Results */
        <div className="flex items-center justify-center py-16 px-4 text-center">
          <div className="space-y-2">
            <h4 className="text-base font-semibold text-foreground">
              No automations found
            </h4>
            <p className="text-sm text-muted-foreground">
              Try adjusting your search criteria
            </p>
          </div>
        </div>
      ) : (
        /* Table */
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[20.5rem]">Automation</TableHead>
              <TableHead className="w-[8.75rem]">Status</TableHead>
              <TableHead className="w-[6.25rem]">Version</TableHead>
              <TableHead className="w-[8.75rem] text-right">Created</TableHead>
              <TableHead className="w-[5rem]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {automations.map((workflow) => (
              <TableRow
                key={workflow._id}
                onClick={() => handleRowClick(workflow)}
                className="cursor-pointer"
              >
                <TableCell>
                  <span className="text-sm font-medium text-foreground truncate px-2">
                    {workflow.name}
                  </span>
                </TableCell>
                <TableCell>{getStatusBadge(workflow.status)}</TableCell>
                <TableCell>
                  <span className="text-xs text-muted-foreground">
                    {workflow.version}
                  </span>
                </TableCell>
                <TableCell className="text-right">
                  <span className="text-xs text-muted-foreground">
                    {formatDate(new Date(workflow._creationTime), 'short')}
                  </span>
                </TableCell>
                <TableCell>
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
                          handleDuplicateAutomation(workflow);
                        }}
                      >
                        <Copy className="size-4 mr-2 text-muted-foreground p-0.5" />
                        <span className="text-sm font-medium text-muted-foreground">
                          Duplicate
                        </span>
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteClick(workflow);
                        }}
                        className="text-destructive focus:text-destructive"
                      >
                        <Trash2 className="size-4 mr-2" />
                        <span className="text-sm font-medium">Delete</span>
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
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
    </div>
  );
}
