'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { FormDialog } from '@tale/ui/dialog/form-dialog';
import { FormSection } from '@tale/ui/form-section';
import { Textarea } from '@tale/ui/textarea';
import { useForm } from '@tale/ui/use-form';
import { useToast } from '@tale/ui/use-toast';
import { useMemo } from 'react';
import * as z from 'zod';

import { useT } from '@/lib/i18n/client';

import { useCloseLegalMatter } from '../hooks/mutations';
import { mapLegalHoldError } from './legal-hold-errors';

interface CloseMatterDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  matter: {
    _id: string;
    name: string;
    linkedActiveHolds: number;
  } | null;
}

interface FormValues {
  reason: string;
}

export function CloseMatterDialog({
  open,
  onOpenChange,
  matter,
}: CloseMatterDialogProps) {
  const { t } = useT('governance');
  const { toast } = useToast();
  const { mutateAsync, isPending } = useCloseLegalMatter();

  const schema = useMemo(
    () => z.object({ reason: z.string().trim().max(2000) }),
    [],
  );

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { reason: '' },
  });
  const { register, handleSubmit, formState, reset } = form;

  const onSubmit = handleSubmit(async (values) => {
    if (!matter) return;
    try {
      const res = await mutateAsync({
        matterId: matter._id,
        releaseReason: values.reason.trim() || undefined,
      });
      toast({
        title: t('legalHold.toasts.matterClosedTitle'),
        description: t('legalHold.toasts.matterClosedDescription', {
          count: res.releaseRequestsFiled,
        }),
        variant: 'success',
      });
      onOpenChange(false);
      reset();
    } catch (err) {
      const mapped = mapLegalHoldError(err, t);
      toast({
        title: mapped.title,
        description: mapped.description,
        variant: 'destructive',
      });
    }
  });

  const handleOpenChange = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={handleOpenChange}
      title={t('legalHold.dialogs.closeMatter.title')}
      description={t('legalHold.dialogs.closeMatter.description', {
        count: matter?.linkedActiveHolds ?? 0,
      })}
      isSubmitting={isPending}
      isValid={formState.isValid && matter !== null}
      onSubmit={onSubmit}
      submitText={t('legalHold.dialogs.closeMatter.submit')}
    >
      <FormSection>
        <Textarea
          id="close-matter-reason"
          rows={3}
          label={t('legalHold.dialogs.closeMatter.reasonLabel')}
          placeholder={t('legalHold.dialogs.closeMatter.reasonPlaceholder')}
          {...register('reason')}
          errorMessage={formState.errors.reason?.message}
        />
      </FormSection>
    </FormDialog>
  );
}
