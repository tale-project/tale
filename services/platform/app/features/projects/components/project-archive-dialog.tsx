'use client';

import { useState } from 'react';

import { ConfirmDialog } from '@/app/components/ui/dialog/confirm-dialog';
import { toast } from '@/app/hooks/use-toast';
import { BackendError } from '@/app/lib/backend/backend-error';
import { useT } from '@/lib/i18n/client';

import { useArchiveProject, useRestoreProject } from '../hooks/mutations';

interface ProjectArchiveDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  isArchived: boolean;
  projectName: string;
}

export function ProjectArchiveDialog({
  open,
  onOpenChange,
  projectId,
  isArchived,
  projectName,
}: ProjectArchiveDialogProps) {
  const { t } = useT('projects');
  const { mutateAsync: archiveProject } = useArchiveProject();
  const { mutateAsync: restoreProject } = useRestoreProject();
  const [isBusy, setIsBusy] = useState(false);

  const handleConfirm = async () => {
    setIsBusy(true);
    try {
      if (isArchived) {
        await restoreProject({ projectId });
        toast({ title: t('settings.restoreSuccess'), variant: 'success' });
      } else {
        await archiveProject({ projectId });
        toast({ title: t('settings.archiveSuccess'), variant: 'success' });
      }
      onOpenChange(false);
    } catch (error) {
      if (error instanceof BackendError) {
        const code = error.data?.code;
        if (code) {
          toast({
            title: t('errors.' + code, {
              defaultValue: isArchived
                ? t('settings.restoreError')
                : t('settings.archiveError'),
            }),
            variant: 'destructive',
          });
          return;
        }
      }
      console.error('archive/restore failed', error);
      toast({
        title: isArchived
          ? t('settings.restoreError')
          : t('settings.archiveError'),
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
      title={
        isArchived ? t('settings.restoreButton') : t('settings.archiveButton')
      }
      description={
        <span>
          {isArchived
            ? t('settings.restoreDescription')
            : t('settings.archiveDescription')}
          <br />
          <strong className="mt-1 inline-block">{projectName}</strong>
        </span>
      }
      confirmText={
        isArchived ? t('settings.restoreButton') : t('settings.archiveButton')
      }
      variant="default"
      isLoading={isBusy}
      onConfirm={handleConfirm}
    />
  );
}
