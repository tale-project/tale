'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMemo, useState } from 'react';
import * as z from 'zod';

import { FormDialog } from '@/app/components/ui/dialog/form-dialog';
import { Input } from '@/app/components/ui/forms/input';
import { useForm } from '@/app/components/ui/forms/use-form';
import { useCreateFolder } from '@/app/features/documents/hooks/mutations';
import { extractErrorCode } from '@/app/features/shared/lib/extract-error-code';
import { useToast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';

interface ProjectCreateFolderDialogProps {
  organizationId: string;
  projectId: string;
  /** Create inside this folder; omitted = at the project root. */
  parentFolderId?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type FolderFormData = {
  name: string;
};

/**
 * Project twin of the hub's CreateFolderDialog, minus the team select —
 * project folders carry no teams (scope mutual exclusivity); access is the
 * project's own edit gate. Folder vocabulary reuses the documents strings.
 */
export function ProjectCreateFolderDialog({
  organizationId,
  projectId,
  parentFolderId,
  open,
  onOpenChange,
}: ProjectCreateFolderDialogProps) {
  const { t: tDocuments } = useT('documents');
  const { toast } = useToast();
  const { mutateAsync: createFolder } = useCreateFolder();

  const nameRequiredError = tDocuments('folder.nameRequired');
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
        parentId: parentFolderId,
        projectId,
      });

      toast({ title: tDocuments('folder.created'), variant: 'success' });

      reset();
      onOpenChange(false);
    } catch (error) {
      console.error('Failed to create project folder:', error);
      const isDuplicate = extractErrorCode(error) === 'FOLDER_DUPLICATE_NAME';
      toast({
        title: isDuplicate
          ? tDocuments('folder.duplicateName')
          : tDocuments('folder.createFailed'),
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
        id="project-folder-name"
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
