'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import * as z from 'zod';

import { FormDialog } from '@/app/components/ui/dialog/form-dialog';
import { FormSection } from '@/app/components/ui/forms/form-section';
import { Input } from '@/app/components/ui/forms/input';
import { Textarea } from '@/app/components/ui/forms/textarea';
import { useToast } from '@/app/hooks/use-toast';
import type { Id } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';

import { mapDsrError } from './data-subject-requests-errors';
import { useExtendErasureDeadline } from './hooks/mutations';

const MIN_EXTRA_DAYS = 1;
const MAX_EXTRA_DAYS = 60;

interface ExtendDeadlineDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  requestId: Id<'gdprErasureRequests'>;
}

interface FormValues {
  extraDays: number;
  extensionReason: string;
}

export function ExtendDeadlineDialog({
  open,
  onOpenChange,
  requestId,
}: ExtendDeadlineDialogProps) {
  const { t } = useT('governance');
  const { toast } = useToast();
  const { mutateAsync, isPending } = useExtendErasureDeadline();

  const schema = useMemo(() => {
    const extraDaysError = t(
      'dataSubjectRequests.dialogs.extendDeadline.extraDaysError',
      { min: MIN_EXTRA_DAYS, max: MAX_EXTRA_DAYS },
    );
    return z.object({
      extraDays: z
        .number({ message: extraDaysError })
        .int(extraDaysError)
        .min(MIN_EXTRA_DAYS, extraDaysError)
        .max(MAX_EXTRA_DAYS, extraDaysError),
      extensionReason: z
        .string()
        .trim()
        .min(10, t('dataSubjectRequests.errors.reasonTooShort'))
        .max(2000),
    });
  }, [t]);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    mode: 'onChange',
    defaultValues: {
      extraDays: 30,
      extensionReason: '',
    },
  });
  const { handleSubmit, register, formState, reset } = form;

  useEffect(() => {
    if (!open) reset();
  }, [open, reset]);

  const onSubmit = handleSubmit(async (values) => {
    try {
      await mutateAsync({
        requestId,
        extraDays: values.extraDays,
        extensionReason: values.extensionReason.trim(),
      });
      toast({
        title: t('dataSubjectRequests.toasts.extendedTitle'),
        description: t('dataSubjectRequests.toasts.extendedDescription', {
          days: values.extraDays,
        }),
        variant: 'success',
      });
      onOpenChange(false);
      reset();
    } catch (err) {
      const mapped = mapDsrError(err, t);
      toast({
        title: mapped.title,
        description: mapped.description,
        variant: 'destructive',
      });
    }
  });

  return (
    <FormDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
      title={t('dataSubjectRequests.dialogs.extendDeadline.title')}
      description={t('dataSubjectRequests.dialogs.extendDeadline.description')}
      isSubmitting={isPending}
      isValid={formState.isValid}
      onSubmit={onSubmit}
      submitText={t('dataSubjectRequests.dialogs.extendDeadline.submit')}
    >
      <FormSection>
        <Input
          id="dsr-extra-days"
          type="number"
          min={MIN_EXTRA_DAYS}
          max={MAX_EXTRA_DAYS}
          step={1}
          label={t(
            'dataSubjectRequests.dialogs.extendDeadline.extraDaysLabel',
            { min: MIN_EXTRA_DAYS, max: MAX_EXTRA_DAYS },
          )}
          description={t(
            'dataSubjectRequests.dialogs.extendDeadline.extraDaysDescription',
          )}
          required
          {...register('extraDays', { valueAsNumber: true })}
          errorMessage={formState.errors.extraDays?.message}
        />
        <Textarea
          id="dsr-extension-reason"
          rows={3}
          label={t(
            'dataSubjectRequests.dialogs.extendDeadline.extensionReasonLabel',
          )}
          placeholder={t(
            'dataSubjectRequests.dialogs.extendDeadline.extensionReasonPlaceholder',
          )}
          required
          {...register('extensionReason')}
          errorMessage={formState.errors.extensionReason?.message}
        />
      </FormSection>
    </FormDialog>
  );
}
