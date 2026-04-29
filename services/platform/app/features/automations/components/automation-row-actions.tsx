'use client';

import { Copy, Pencil, Trash2 } from 'lucide-react';
import { useMemo, useCallback } from 'react';

import {
  EntityRowActions,
  useEntityRowDialogs,
} from '@/app/components/ui/entity/entity-row-actions';
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';

import {
  useDeleteWorkflowFile,
  useDuplicateWorkflowFile,
  useRenameWorkflow,
} from '../hooks/file-mutations';
import { DeleteAutomationDialog } from './automation-delete-dialog';
import { AutomationRenameDialog } from './automation-rename-dialog';

interface AutomationRowActionsProps {
  organizationId: string;
  automation: { _id: string; name: string };
}

export function AutomationRowActions({
  organizationId,
  automation,
}: AutomationRowActionsProps) {
  const { t: tCommon } = useT('common');
  const { t: tToast } = useT('toast');
  const dialogs = useEntityRowDialogs(['delete', 'rename']);

  const { mutate: duplicateAutomation } = useDuplicateWorkflowFile();
  const { mutate: deleteAutomation, isPending: isDeleting } =
    useDeleteWorkflowFile();
  const { mutateAsync: renameWorkflow } = useRenameWorkflow();

  const workflowArgs = useMemo(
    () => ({
      organizationId,
      workflowSlug: automation._id,
    }),
    [organizationId, automation._id],
  );

  const handleDuplicate = useCallback(() => {
    duplicateAutomation(workflowArgs, {
      onSuccess: () => {
        toast({
          title: tToast('success.automationDuplicated'),
          variant: 'success',
        });
      },
      onError: (error: Error) => {
        console.error('Failed to duplicate automation:', error);
        toast({
          title: tToast('error.automationDuplicateFailed'),
          variant: 'destructive',
        });
      },
    });
  }, [duplicateAutomation, workflowArgs, tToast]);

  const handleRename = useCallback(
    async (name: string) => {
      try {
        await renameWorkflow({
          organizationId,
          oldSlug: automation._id,
          newSlug: name,
        });
        toast({
          title: tToast('success.automationRenamed'),
          variant: 'success',
        });
      } catch (error: unknown) {
        console.error('Failed to rename automation:', error);
        toast({
          title: tToast('error.automationRenameFailed'),
          variant: 'destructive',
        });
        throw error;
      }
    },
    [renameWorkflow, organizationId, automation._id, tToast],
  );

  const handleDeleteConfirm = useCallback(() => {
    deleteAutomation(workflowArgs, {
      onSuccess: () => {
        dialogs.setOpen.delete(false);
      },
      onError: (error: Error) => {
        console.error('Failed to delete automation:', error);
        toast({
          title: tToast('error.automationDeleteFailed'),
          variant: 'destructive',
        });
      },
    });
  }, [deleteAutomation, workflowArgs, dialogs.setOpen, tToast]);

  const actions = useMemo(
    () => [
      {
        key: 'duplicate',
        label: tCommon('actions.duplicate'),
        icon: Copy,
        onClick: handleDuplicate,
      },
      {
        key: 'rename',
        label: tCommon('actions.rename'),
        icon: Pencil,
        onClick: dialogs.open.rename,
      },
      {
        key: 'delete',
        label: tCommon('actions.delete'),
        icon: Trash2,
        onClick: dialogs.open.delete,
        destructive: true,
      },
    ],
    [tCommon, handleDuplicate, dialogs.open],
  );

  return (
    <>
      <EntityRowActions actions={actions} />

      <AutomationRenameDialog
        open={dialogs.isOpen.rename}
        onOpenChange={dialogs.setOpen.rename}
        currentName={automation.name}
        onRename={handleRename}
      />

      <DeleteAutomationDialog
        open={dialogs.isOpen.delete}
        onOpenChange={dialogs.setOpen.delete}
        onConfirm={handleDeleteConfirm}
        workflowName={automation.name}
        isDeleting={isDeleting}
      />
    </>
  );
}
