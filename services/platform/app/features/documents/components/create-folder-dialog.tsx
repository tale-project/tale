'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { FormDialog } from '@tale/ui/dialog/form-dialog';
import { Input } from '@tale/ui/input';
import { Select } from '@tale/ui/select';
import { useForm } from '@tale/ui/use-form';
import { useToast } from '@tale/ui/use-toast';
import { type RefObject, useState, useMemo } from 'react';
import * as z from 'zod';

import { useTeams } from '@/app/features/settings/teams/hooks/queries';
import { extractErrorCode } from '@/app/features/shared/lib/extract-error-code';
import { useT } from '@/lib/i18n/client';

import { useCreateFolder } from '../hooks/mutations';

const ORG_WIDE_VALUE = '__org_wide__';

interface CreateFolderDialogProps {
  organizationId: string;
  parentFolderId?: string;
  parentFolderTeamId?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  restoreFocusRef?: RefObject<HTMLElement | null>;
  onSuccess?: () => void;
}

type FolderFormData = {
  name: string;
  teamId: string;
};

export function CreateFolderDialog({
  organizationId,
  parentFolderId,
  parentFolderTeamId,
  open,
  onOpenChange,
  restoreFocusRef,
  onSuccess,
}: CreateFolderDialogProps) {
  const { t: tDocuments } = useT('documents');
  const { toast } = useToast();
  const { mutateAsync: createFolder } = useCreateFolder();
  const { teams } = useTeams();

  const nameRequiredError = tDocuments('folder.nameRequired');
  const schema = useMemo(
    () =>
      z.object({
        name: z.string().trim().min(1, nameRequiredError),
        teamId: z.string(),
      }),
    [nameRequiredError],
  );

  const [isSubmitting, setIsSubmitting] = useState(false);

  const form = useForm<FolderFormData>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', teamId: ORG_WIDE_VALUE },
  });

  const { handleSubmit, register, reset, formState } = form;

  const onSubmit = async (data: FolderFormData) => {
    setIsSubmitting(true);
    try {
      const teamId =
        data.teamId === ORG_WIDE_VALUE ? undefined : data.teamId || undefined;
      await createFolder({
        organizationId,
        name: data.name,
        parentId: parentFolderId ? parentFolderId : undefined,
        teamId,
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
      restoreFocusRef={restoreFocusRef}
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
      {teams && teams.length > 0 && !parentFolderTeamId && (
        <Select
          id="folder-team"
          label={tDocuments('teamTags.team')}
          placeholder={tDocuments('teamTags.orgWide')}
          value={form.watch('teamId')}
          onValueChange={(value) => form.setValue('teamId', value)}
          options={[
            { value: ORG_WIDE_VALUE, label: tDocuments('teamTags.orgWide') },
            ...teams.map((team: { id: string; name: string }) => ({
              value: team.id,
              label: team.name,
            })),
          ]}
        />
      )}
    </FormDialog>
  );
}
