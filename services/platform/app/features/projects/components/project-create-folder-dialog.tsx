'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { FormDialog } from '@tale/ui/dialog/form-dialog';
import { Input } from '@tale/ui/input';
import { useForm } from '@tale/ui/use-form';
import { useToast } from '@tale/ui/use-toast';
import { useMemo, useState } from 'react';
import * as z from 'zod';

import { useCreateFolder } from '@/app/features/documents/hooks/mutations';
import { extractErrorCode } from '@/app/features/shared/lib/extract-error-code';
import { failureDetail } from '@/app/lib/backend/adapters';
import { useT } from '@/lib/i18n/client';
import {
  FOLDER_NAME_MAX,
  folderNameSchemaByReason,
} from '@/lib/shared/utils/folder-name';

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
  const { t: tCommon } = useT('common');
  const { toast } = useToast();
  const { mutateAsync: createFolder } = useCreateFolder();

  // The server's folder-name rule, checked here so a refused name is named
  // at the field, by the rule it broke, before any request.
  const nameRequiredError = tDocuments('folder.nameRequired');
  const nameTooLongError = tCommon('validation.maxLength', {
    field: tDocuments('folder.folderName'),
    max: FOLDER_NAME_MAX,
  });
  const nameSeparatorError = tDocuments('folder.nameSeparator');
  const nameControlError = tDocuments('folder.nameControl');
  const nameDotError = tDocuments('folder.nameDot');
  const invalidNameError = tDocuments('folder.invalidName');
  const schema = useMemo(
    () =>
      z.object({
        name: folderNameSchemaByReason({
          blank: nameRequiredError,
          too_long: nameTooLongError,
          separator: nameSeparatorError,
          control: nameControlError,
          dot: nameDotError,
        }),
      }),
    [
      nameRequiredError,
      nameTooLongError,
      nameSeparatorError,
      nameControlError,
      nameDotError,
    ],
  );

  const [isSubmitting, setIsSubmitting] = useState(false);

  const form = useForm<FolderFormData>({
    resolver: zodResolver(schema),
    defaultValues: { name: '' },
  });

  const { handleSubmit, register, reset, setError, formState } = form;

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
      // The server refuses with a rule, not a reason code: name the whole
      // rule at the field.
      if (extractErrorCode(error) === 'FOLDER_NAME_INVALID') {
        setError('name', { message: invalidNameError });
        return;
      }
      console.error('Failed to create project folder:', error);
      const isDuplicate = extractErrorCode(error) === 'FOLDER_NAME_TAKEN';
      toast({
        title: isDuplicate
          ? tDocuments('folder.duplicateName')
          : tDocuments('folder.createFailed'),
        // A taken name is the whole story; any other refusal says why.
        description: isDuplicate ? undefined : failureDetail(error),
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
