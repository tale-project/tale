'use client';

import { useState } from 'react';

import { ConfirmDialog } from '@/app/components/ui/dialog/confirm-dialog';
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import { AppError } from '@/lib/shared/errors/app-error';

import { useArchiveTask, useRestoreTask } from '../hooks/mutations';

interface TaskArchiveDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  taskId: string;
  taskTitle: string;
  isArchived: boolean;
  /** Called after a successful archive (not restore) — e.g. close the detail sheet. */
  onArchived?: () => void;
}

export function TaskArchiveDialog({
  open,
  onOpenChange,
  taskId,
  taskTitle,
  isArchived,
  onArchived,
}: TaskArchiveDialogProps) {
  const { t } = useT('tasks');
  const { mutateAsync: archiveTask } = useArchiveTask();
  const { mutateAsync: restoreTask } = useRestoreTask();
  const [isBusy, setIsBusy] = useState(false);

  const handleConfirm = async () => {
    setIsBusy(true);
    try {
      if (isArchived) {
        await restoreTask({ taskId });
        toast({ title: t('archive.restoreSuccess'), variant: 'success' });
      } else {
        await archiveTask({ taskId });
        toast({ title: t('archive.success'), variant: 'success' });
        onArchived?.();
      }
      onOpenChange(false);
    } catch (error) {
      if (error instanceof AppError) {
        const code = error.data?.code;
        if (code) {
          toast({
            title: t('errors.' + code, {
              defaultValue: isArchived
                ? t('archive.restoreError')
                : t('archive.error'),
            }),
            variant: 'destructive',
          });
          return;
        }
      }
      console.error('[tasks] archive/restore failed', error);
      toast({
        title: isArchived ? t('archive.restoreError') : t('archive.error'),
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
      title={isArchived ? t('actions.restore') : t('archive.confirmTitle')}
      description={
        <span>
          {isArchived
            ? t('archive.restoreDescription')
            : t('archive.confirmDescription')}
          <br />
          <strong className="mt-1 inline-block">{taskTitle}</strong>
        </span>
      }
      confirmText={isArchived ? t('actions.restore') : t('actions.archive')}
      isLoading={isBusy}
      onConfirm={handleConfirm}
    />
  );
}
