'use client';

import { useMemo, useCallback, useState } from 'react';
import { Copy, Trash2 } from 'lucide-react';
import {
  EntityRowActions,
  useEntityRowDialogs,
} from '@/components/ui/entity-row-actions';
import { Doc } from '@/convex/_generated/dataModel';
import AutomationDeleteDialog from './automation-delete-dialog';
import { useDuplicateAutomation, useDeleteAutomation } from '../hooks';
import { toast } from '@/hooks/use-toast';
import { useT } from '@/lib/i18n';

interface AutomationRowActionsProps {
  automation: Doc<'wfDefinitions'>;
}

export default function AutomationRowActions({
  automation,
}: AutomationRowActionsProps) {
  const { t: tCommon } = useT('common');
  const { t: tToast } = useT('toast');
  const { t: tTables } = useT('tables');
  const dialogs = useEntityRowDialogs(['delete']);
  const [isDeleting, setIsDeleting] = useState(false);

  const duplicateAutomation = useDuplicateAutomation();
  const deleteAutomation = useDeleteAutomation();

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
        key: 'delete',
        label: tCommon('actions.delete'),
        icon: Trash2,
        onClick: dialogs.open.delete,
        destructive: true,
      },
    ],
    [tCommon, handleDuplicate, dialogs.open]
  );

  return (
    <>
      <EntityRowActions actions={actions} />

      <AutomationDeleteDialog
        open={dialogs.isOpen.delete}
        onOpenChange={dialogs.setOpen.delete}
        onConfirm={handleDeleteConfirm}
        workflowName={automation.name}
        isDeleting={isDeleting}
      />
    </>
  );
}
