'use client';

import { CircleStop, Copy, Pencil, Trash2, Upload } from 'lucide-react';
import { useMemo, useCallback } from 'react';

import { ConfirmDialog } from '@/app/components/ui/dialog/confirm-dialog';
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
  useToggleWorkflowEnabled,
} from '../hooks/file-mutations';
import { DeleteAutomationDialog } from './automation-delete-dialog';
import { AutomationRenameDialog } from './automation-rename-dialog';

interface AutomationRowActionsProps {
  automation: { _id: string; name: string; status: string };
}

export function AutomationRowActions({
  automation,
}: AutomationRowActionsProps) {
  const { t: tCommon } = useT('common');
  const { t: tAutomations } = useT('automations');
  const { t: tToast } = useT('toast');
  const dialogs = useEntityRowDialogs(['delete', 'rename', 'unpublish']);

  const { mutate: duplicateAutomation } = useDuplicateWorkflowFile();
  const { mutate: deleteAutomation, isPending: isDeleting } =
    useDeleteWorkflowFile();
  const toggleEnabled = useToggleWorkflowEnabled();
  const { mutateAsync: renameWorkflow } = useRenameWorkflow();

  const workflowArgs = useMemo(
    () => ({ orgSlug: 'default', workflowSlug: automation._id }),
    [automation._id],
  );

  const handlePublish = useCallback(async () => {
    try {
      await toggleEnabled.mutate(workflowArgs);
      toast({
        title: tToast('success.automationPublished'),
        variant: 'success',
      });
    } catch (error: unknown) {
      console.error('Failed to publish automation:', error);
      toast({
        title: tToast('error.automationPublishFailed'),
        variant: 'destructive',
      });
    }
  }, [toggleEnabled, workflowArgs, tToast]);

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
          orgSlug: 'default',
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
    [renameWorkflow, automation._id, tToast],
  );

  const handleUnpublishConfirm = useCallback(async () => {
    try {
      await toggleEnabled.mutate(workflowArgs);
      dialogs.setOpen.unpublish(false);
      toast({
        title: tToast('success.automationDeactivated'),
        variant: 'success',
      });
    } catch (error: unknown) {
      console.error('Failed to unpublish automation:', error);
      toast({
        title: tToast('error.automationDeactivateFailed'),
        variant: 'destructive',
      });
    }
  }, [toggleEnabled, workflowArgs, dialogs.setOpen, tToast]);

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
        key: 'publish',
        label: tCommon('actions.publish'),
        icon: Upload,
        onClick: handlePublish,
        visible: automation.status === 'archived',
      },
      {
        key: 'unpublish',
        label: tCommon('actions.deactivate'),
        icon: CircleStop,
        onClick: dialogs.open.unpublish,
        visible: automation.status === 'active',
      },
      {
        key: 'delete',
        label: tCommon('actions.delete'),
        icon: Trash2,
        onClick: dialogs.open.delete,
        destructive: true,
      },
    ],
    [tCommon, handlePublish, handleDuplicate, dialogs.open, automation.status],
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

      <ConfirmDialog
        open={dialogs.isOpen.unpublish}
        onOpenChange={dialogs.setOpen.unpublish}
        title={tAutomations('deactivateDialog.title')}
        description={tAutomations('deactivateDialog.description', {
          name: automation.name,
        })}
        confirmText={tCommon('actions.deactivate')}
        loadingText={tCommon('actions.deactivating')}
        isLoading={toggleEnabled.isPending}
        onConfirm={handleUnpublishConfirm}
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
