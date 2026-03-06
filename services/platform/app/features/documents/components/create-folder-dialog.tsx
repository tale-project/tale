'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useState, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import * as z from 'zod';

import { FormDialog } from '@/app/components/ui/dialog/form-dialog';
import { Input } from '@/app/components/ui/forms/input';
import { useToast } from '@/app/hooks/use-toast';
import { toId } from '@/convex/lib/type_cast_helpers';
import { useT } from '@/lib/i18n/client';

import { useCreateFolder } from '../hooks/mutations';

interface CreateFolderDialogProps {
  organizationId: string;
  parentFolderId?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

type FolderFormData = {
  name: string;
};

export function CreateFolderDialog({
  organizationId,
  parentFolderId,
  open,
  onOpenChange,
  onSuccess,
}: CreateFolderDialogProps) {
  const { t: tDocuments } = useT('documents');
  const { toast } = useToast();
  const { mutateAsync: createFolder } = useCreateFolder();

  const nameRequiredError = tDocuments('folder.folderNamePlaceholder');
  const schema = useMemo(
    () =>
      z.object({
        name: z.string().trim().min(1, nameRequiredError),
      }),
    [nameRequiredError],
  );

  const [isSubmitting, setIsSubmitting] = useState(false);

  const form = useForm<FolderFormData>({
    resolver: zodResolver(schema),
    defaultValues: { name: '' },
  });

  const { handleSubmit, register, reset, formState } = form;

  const onSubmit = async (data: FolderFormData) => {
    setIsSubmitting(true);
    try {
      await createFolder({
        organizationId,
        name: data.name,
        parentId: parentFolderId ? toId<'folders'>(parentFolderId) : undefined,
      });

      toast({
        title: tDocuments('folder.created'),
        variant: 'success',
      });

      reset();
      onOpenChange(false);
      onSuccess?.();
    } catch (error) {
      console.error('Failed to create folder:', error);
      toast({
        title: tDocuments('folder.createFailed'),
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) {
      reset();
    }
    onOpenChange(isOpen);
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={handleOpenChange}
      title={tDocuments('folder.createFolder')}
      submitText={tDocuments('folder.createFolder')}
      submittingText={tDocuments('folder.creating')}
      isSubmitting={isSubmitting}
      onSubmit={handleSubmit(onSubmit)}
    >
      <Input
        id="folder-name"
        label={tDocuments('folder.folderName')}
        placeholder={tDocuments('folder.folderNamePlaceholder')}
        {...register('name')}
        className="w-full"
        required
        errorMessage={formState.errors.name?.message}
      />
    </FormDialog>
  );
}
