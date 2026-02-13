'use client';

import { CircleStop, Copy, Pencil, Trash2, Upload } from 'lucide-react';
import { useMemo, useCallback, useState } from 'react';

import { ConfirmDialog } from '@/app/components/ui/dialog/confirm-dialog';
import {
  EntityRowActions,
  useEntityRowDialogs,
} from '@/app/components/ui/entity/entity-row-actions';
import { useAuth } from '@/app/hooks/use-convex-auth';
import { toast } from '@/app/hooks/use-toast';
import { Doc } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';

import { useWfAutomationCollection } from '../hooks/collections';
import {
  useDeleteAutomation,
  useDuplicateAutomation,
  useRepublishAutomation,
  useUnpublishAutomation,
  useUpdateAutomation,
} from '../hooks/mutations';
import { DeleteAutomationDialog } from './automation-delete-dialog';
import { AutomationRenameDialog } from './automation-rename-dialog';

interface AutomationRowActionsProps {
  automation: Doc<'wfDefinitions'>;
}

export function AutomationRowActions({
  automation,
}: AutomationRowActionsProps) {
  const { t: tCommon } = useT('common');
  const { t: tAutomations } = useT('automations');
  const { t: tToast } = useT('toast');
  const { user } = useAuth();
  const dialogs = useEntityRowDialogs(['delete', 'rename', 'unpublish']);
  const [isDeleting, setIsDeleting] = useState(false);

  const wfAutomationCollection = useWfAutomationCollection(
    automation.organizationId,
  );
  const { mutateAsync: duplicateAutomation } = useDuplicateAutomation();
  const deleteAutomation = useDeleteAutomation(wfAutomationCollection);
  const { mutateAsync: republishAutomation } = useRepublishAutomation();
  const { mutateAsync: unpublishAutomation, isPending: isUnpublishing } =
    useUnpublishAutomation();
  const updateAutomation = useUpdateAutomation(wfAutomationCollection);

  const handlePublish = useCallback(async () => {
    if (!user) return;
    try {
      await republishAutomation({
        wfDefinitionId: automation._id,
        publishedBy: user.email ?? user.userId,
      });
      toast({
        title: tToast('success.automationPublished'),
        variant: 'success',
      });
    } catch (error) {
      console.error('Failed to publish automation:', error);
      toast({
        title: tToast('error.automationPublishFailed'),
        variant: 'destructive',
      });
    }
  }, [republishAutomation, automation._id, user, tToast]);

  const handleDuplicate = useCallback(async () => {
    try {
      await duplicateAutomation({
        wfDefinitionId: automation._id,
      });
      toast({
        title: tToast('success.automationDuplicated'),
        variant: 'success',
      });
    } catch (error) {
      console.error('Failed to duplicate automation:', error);
      toast({
        title: tToast('error.automationDuplicateFailed'),
        variant: 'destructive',
      });
    }
  }, [duplicateAutomation, automation._id, tToast]);

  const handleRename = useCallback(
    async (name: string) => {
      if (!user) return;
      try {
        await updateAutomation({
          wfDefinitionId: automation._id,
          updates: { name },
          updatedBy: user.userId,
        });
        toast({
          title: tToast('success.automationRenamed'),
          variant: 'success',
        });
      } catch (error) {
        console.error('Failed to rename automation:', error);
        toast({
          title: tToast('error.automationRenameFailed'),
          variant: 'destructive',
        });
        throw error;
      }
    },
    [updateAutomation, automation._id, user, tToast],
  );

  const handleUnpublishConfirm = useCallback(async () => {
    if (!user) return;
    try {
      await unpublishAutomation({
        wfDefinitionId: automation._id,
        updatedBy: user.userId,
      });
      dialogs.setOpen.unpublish(false);
      toast({
        title: tToast('success.automationDeactivated'),
        variant: 'success',
      });
    } catch (error) {
      console.error('Failed to unpublish automation:', error);
      toast({
        title: tToast('error.automationDeactivateFailed'),
        variant: 'destructive',
      });
    }
  }, [unpublishAutomation, automation._id, user, dialogs.setOpen, tToast]);

  const handleDeleteConfirm = useCallback(async () => {
    setIsDeleting(true);
    try {
      await deleteAutomation({
        wfDefinitionId: automation._id,
      });
      dialogs.setOpen.delete(false);
    } catch (error) {
      console.error('Failed to delete automation:', error);
      toast({
        title: tToast('error.automationDeleteFailed'),
        variant: 'destructive',
      });
    } finally {
      setIsDeleting(false);
    }
  }, [deleteAutomation, automation._id, dialogs.setOpen, tToast]);

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
        isLoading={isUnpublishing}
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
