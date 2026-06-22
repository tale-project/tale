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
  /**
   * App-owned workflows can't be removed or re-slugged from the global surface
   * (that would orphan the app) — they change only via app uninstall. Delete +
   * rename are hidden; the workflow definition is still editable in the editor.
   */
  isAppOwned?: boolean;
}

export function AutomationRowActions({
  organizationId,
  automation,
  isAppOwned = false,
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
        // Rethrow so the rename dialog owns error display — it shows a
        // field-level message for a name collision (DUPLICATE_NAME) and a
        // destructive toast otherwise. Toasting here too would double up (and
        // pair a toast with the inline field error on collisions).
        console.error('Failed to rename automation:', error);
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
        visible: !isAppOwned,
      },
      {
        key: 'delete',
        label: tCommon('actions.delete'),
        icon: Trash2,
        onClick: dialogs.open.delete,
        destructive: true,
        visible: !isAppOwned,
      },
    ],
    [tCommon, handleDuplicate, dialogs.open, isAppOwned],
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
