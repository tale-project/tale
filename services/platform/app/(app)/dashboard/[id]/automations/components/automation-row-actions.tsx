'use client';

import { useMemo, useCallback, useState } from 'react';
import { Copy, Pencil, Trash2 } from 'lucide-react';
import {
  EntityRowActions,
  useEntityRowDialogs,
} from '@/components/ui/entity/entity-row-actions';
import { Doc } from '@/convex/_generated/dataModel';
import { DeleteAutomationDialog } from './automation-delete-dialog';
import { AutomationRenameDialog } from './automation-rename-dialog';
import { useDuplicateAutomation } from '../hooks/use-duplicate-automation';
import { useDeleteAutomation } from '../hooks/use-delete-automation';
import { useUpdateAutomation } from '../hooks/use-update-automation';
import { toast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/use-convex-auth';
import { useT } from '@/lib/i18n/client';

interface AutomationRowActionsProps {
  automation: Doc<'wfDefinitions'>;
}

export function AutomationRowActions({
  automation,
}: AutomationRowActionsProps) {
  const { t: tCommon } = useT('common');
  const { t: tToast } = useT('toast');
  const { t: tTables } = useT('tables');
  const { user } = useAuth();
  const dialogs = useEntityRowDialogs(['delete', 'rename']);
  const [isDeleting, setIsDeleting] = useState(false);

  const duplicateAutomation = useDuplicateAutomation();
  const deleteAutomation = useDeleteAutomation();
  const updateAutomation = useUpdateAutomation();

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
        title: `${tToast('error.automationDuplicateFailed')}: ${error instanceof Error ? error.message : tTables('cells.unknown')}`,
        variant: 'destructive',
      });
    }
  }, [duplicateAutomation, automation._id, tToast, tTables]);

  const handleRename = useCallback(
    async (name: string) => {
      if (!user) return;
      try {
        await updateAutomation({
          wfDefinitionId: automation._id,
          updates: { name },
          updatedBy: user._id,
        });
        toast({
          title: tToast('success.automationRenamed'),
          variant: 'success',
        });
      } catch (error) {
        console.error('Failed to rename automation:', error);
        toast({
          title: `${tToast('error.automationRenameFailed')}: ${error instanceof Error ? error.message : tTables('cells.unknown')}`,
          variant: 'destructive',
        });
        throw error;
      }
    },
    [updateAutomation, automation._id, user, tToast, tTables],
  );

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
        title: `${tToast('error.automationDeleteFailed')}: ${error instanceof Error ? error.message : tTables('cells.unknown')}`,
        variant: 'destructive',
      });
    } finally {
      setIsDeleting(false);
    }
  }, [deleteAutomation, automation._id, dialogs.setOpen, tToast, tTables]);

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
