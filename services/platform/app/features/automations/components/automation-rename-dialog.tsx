'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { ConvexError } from 'convex/values';
import { useEffect, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { FormDialog } from '@/app/components/ui/dialog/form-dialog';
import { Input } from '@/app/components/ui/forms/input';
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';

type FormData = {
  name: string;
};

interface AutomationRenameDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentName: string;
  onRename: (name: string) => Promise<void>;
}

export function AutomationRenameDialog({
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
        name: z
          .string()
          .trim()
          .min(
            1,
            tCommon('validation.required', {
              field: tAutomations('configuration.name'),
            }),
          ),
      }),
    [tCommon, tAutomations],
  );

  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { isSubmitting, isDirty, errors },
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

    try {
      await onRename(trimmedName);
      onOpenChange(false);
    } catch (error) {
      // A name collision is a field-level problem — surface it inline like the
      // create dialog does, rather than as a transient toast. Other failures
      // stay a destructive toast.
      if (
        error instanceof ConvexError &&
        error.data?.code === 'DUPLICATE_NAME'
      ) {
        setError('name', {
          message: tAutomations('validation.duplicateName'),
        });
        return;
      }
      toast({
        title: tCommon('errors.somethingWentWrong'),
        variant: 'destructive',
      });
    }
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={tAutomations('renameTitle')}
      submitText={tCommon('actions.save')}
      submittingText={tCommon('actions.saving')}
      isSubmitting={isSubmitting}
      isDirty={isDirty}
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
