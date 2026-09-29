'use client';

import { ConfirmDialog } from '@tale/ui/dialog/confirm-dialog';
import { toast } from '@tale/ui/use-toast';
import { useState } from 'react';

import { failureDetail } from '@/app/lib/backend/adapters';
import { useT } from '@/lib/i18n/client';
import { AppError } from '@/lib/shared/errors/app-error';

import { useDeleteTask } from '../hooks/mutations';

interface TaskDeleteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  taskId: string;
  taskTitle: string;
  /** Called once the task is gone — e.g. close the view that showed it. */
  onDeleted?: () => void;
}

/**
 * Confirms the permanent delete of a task. The backend removes the task with
 * its subtasks, stops their running agent work and releases their files, so
 * the dialog asks in the destructive colour and names the task.
 */
export function TaskDeleteDialog({
  open,
  onOpenChange,
  taskId,
  taskTitle,
  onDeleted,
}: TaskDeleteDialogProps) {
  const { t } = useT('tasks');
  const { mutateAsync: deleteTask } = useDeleteTask();
  const [isBusy, setIsBusy] = useState(false);

  const handleConfirm = async () => {
    setIsBusy(true);
    try {
      await deleteTask({ taskId });
      toast({ title: t('delete.success'), variant: 'success' });
      onOpenChange(false);
      onDeleted?.();
    } catch (error) {
      if (error instanceof AppError) {
        const code = error.data?.code;
        if (code) {
          toast({
            title: t('errors.' + code, { defaultValue: t('delete.error') }),
            variant: 'destructive',
          });
          return;
        }
      }
      console.error('[tasks] delete failed', error);
      toast({
        title: t('delete.error'),
        description: failureDetail(error),
        variant: 'destructive',
      });
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      variant="destructive"
      title={t('delete.confirmTitle')}
      description={
        <span>
          {t('delete.confirmDescription')}
          <br />
          <strong className="mt-1 inline-block">{taskTitle}</strong>
        </span>
      }
      confirmText={t('actions.delete')}
      isLoading={isBusy}
      onConfirm={handleConfirm}
    />
  );
}
