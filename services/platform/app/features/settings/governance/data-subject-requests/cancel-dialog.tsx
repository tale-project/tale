'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import * as z from 'zod';

import { FormDialog } from '@/app/components/ui/dialog/form-dialog';
import { FormSection } from '@/app/components/ui/forms/form-section';
import { Textarea } from '@/app/components/ui/forms/textarea';
import { useToast } from '@/app/hooks/use-toast';
import type { Id } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';

import { mapDsrError } from './data-subject-requests-errors';
import { useCancelErasureRequest } from './hooks/mutations';

interface CancelDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  requestId: Id<'gdprErasureRequests'>;
}

interface FormValues {
  cancellationReason: string;
}

export function CancelDialog({
  open,
  onOpenChange,
  requestId,
}: CancelDialogProps) {
  const { t } = useT('governance');
  const { toast } = useToast();
  const { mutateAsync, isPending } = useCancelErasureRequest();

  const schema = useMemo(
    () =>
      z.object({
        cancellationReason: z
          .string()
          .trim()
          .min(10, t('dataSubjectRequests.errors.reasonTooShort'))
          .max(2000),
      }),
    [t],
  );

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    mode: 'onChange',
    defaultValues: { cancellationReason: '' },
  });
  const { handleSubmit, register, formState, reset } = form;

  useEffect(() => {
    if (!open) reset();
  }, [open, reset]);

  const onSubmit = handleSubmit(async (values) => {
    try {
      await mutateAsync({
        requestId,
        cancellationReason: values.cancellationReason.trim(),
      });
      toast({
        title: t('dataSubjectRequests.toasts.cancelledTitle'),
        description: t('dataSubjectRequests.toasts.cancelledDescription'),
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
      title={t('dataSubjectRequests.dialogs.cancel.title')}
      description={t('dataSubjectRequests.dialogs.cancel.description')}
      isSubmitting={isPending}
      isValid={formState.isValid}
      onSubmit={onSubmit}
      submitText={t('dataSubjectRequests.dialogs.cancel.confirm')}
    >
      <FormSection>
        <Textarea
          id="dsr-cancellation-reason"
          rows={3}
          label={t('dataSubjectRequests.dialogs.cancel.reasonLabel')}
          placeholder={t(
            'dataSubjectRequests.dialogs.cancel.reasonPlaceholder',
          )}
          required
          {...register('cancellationReason')}
          errorMessage={formState.errors.cancellationReason?.message}
        />
      </FormSection>
    </FormDialog>
  );
}
