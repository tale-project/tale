'use client';

import { useEffect, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { FormDialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useT } from '@/lib/i18n';

type FormData = {
  name: string;
};

interface AutomationRenameDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentName: string;
  onRename: (name: string) => Promise<void>;
}

export default function AutomationRenameDialog({
  open,
  onOpenChange,
  currentName,
  onRename,
}: AutomationRenameDialogProps) {
  const { t: tCommon } = useT('common');
  const { t: tAutomations } = useT('automations');

  const formSchema = useMemo(
    () =>
      z.object({
        name: z.string().min(1, tCommon('validation.required', { field: tAutomations('configuration.name') })),
      }),
    [tCommon, tAutomations],
  );

  const {
    register,
    handleSubmit,
    reset,
    formState: { isSubmitting, errors },
  } = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: currentName,
    },
  });

  useEffect(() => {
    if (open) {
      reset({ name: currentName });
    }
  }, [open, currentName, reset]);

  const onSubmit = async (data: FormData) => {
    const trimmedName = data.name.trim();
    if (trimmedName === currentName) {
      onOpenChange(false);
      return;
    }

    await onRename(trimmedName);
    onOpenChange(false);
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={tCommon('actions.rename')}
      submitText={tCommon('actions.save')}
      submittingText={tCommon('actions.saving')}
      isSubmitting={isSubmitting}
      onSubmit={handleSubmit(onSubmit)}
    >
      <Input
        id="rename-name"
        label={tAutomations('configuration.name')}
        required
        {...register('name')}
        placeholder={tAutomations('editDialog.namePlaceholder')}
        disabled={isSubmitting}
        errorMessage={errors.name?.message}
        autoFocus
      />
    </FormDialog>
  );
}
