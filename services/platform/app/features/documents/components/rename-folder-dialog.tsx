'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { FormDialog } from '@tale/ui/dialog/form-dialog';
import { Input } from '@tale/ui/input';
import { useForm } from '@tale/ui/use-form';
import { toast } from '@tale/ui/use-toast';
import { type RefObject, useEffect, useMemo } from 'react';
import * as z from 'zod';

import { extractErrorCode } from '@/app/features/shared/lib/extract-error-code';
import { useT } from '@/lib/i18n/client';
import { folderNameSchema } from '@/lib/shared/utils/folder-name';

import { useRenameFolder } from '../hooks/mutations';

interface RenameFolderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  folderId: string;
  currentName: string;
  restoreFocusRef?: RefObject<HTMLElement | null>;
}

type FormData = { name: string };

export function RenameFolderDialog({
  open,
  onOpenChange,
  folderId,
  currentName,
  restoreFocusRef,
}: RenameFolderDialogProps) {
  const { t } = useT('documents');
  const { mutateAsync: renameFolder } = useRenameFolder();

  const schema = useMemo(
    () =>
      z.object({
        name: folderNameSchema(
          t('folder.nameRequired'),
          t('folder.invalidName'),
        ),
      }),
    [t],
  );

  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { isSubmitting, errors },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { name: currentName },
  });

  useEffect(() => {
    if (open) reset({ name: currentName });
  }, [open, currentName, reset]);

  const onSubmit = async (data: FormData) => {
    if (data.name === currentName.trim()) {
      onOpenChange(false);
      return;
    }
    try {
      await renameFolder({ folderId, name: data.name });
      toast({ title: t('folder.renamed'), variant: 'success' });
      onOpenChange(false);
    } catch (error) {
      const code = extractErrorCode(error);
      if (code === 'FOLDER_NAME_TAKEN') {
        setError('name', { message: t('folder.duplicateName') });
        return;
      }
      if (code === 'FOLDER_NAME_INVALID') {
        setError('name', { message: t('folder.invalidName') });
        return;
      }
      if (code === 'FOLDER_SYNC_MANAGED') {
        setError('name', { message: t('folder.renameSyncManaged') });
        return;
      }
      console.error('Failed to rename folder:', error);
      toast({ title: t('folder.renameFailed'), variant: 'destructive' });
    }
  };

  return (
    <FormDialog
      restoreFocusRef={restoreFocusRef}
      open={open}
      onOpenChange={onOpenChange}
      title={t('folder.renameFolder')}
      submitText={t('actions.rename')}
      submittingText={t('folder.renaming')}
      isSubmitting={isSubmitting}
      onSubmit={handleSubmit(onSubmit)}
    >
      <Input
        id="folder-rename-name"
        label={t('folder.folderName')}
        autoFocus
        {...register('name')}
        className="w-full"
        required
        errorMessage={errors.name?.message}
      />
    </FormDialog>
  );
}
