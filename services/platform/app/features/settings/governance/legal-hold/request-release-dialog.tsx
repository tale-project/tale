'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMemo } from 'react';
import { useForm } from 'react-hook-form';
import * as z from 'zod';

import { FormDialog } from '@/app/components/ui/dialog/form-dialog';
import { FormSection } from '@/app/components/ui/forms/form-section';
import { Textarea } from '@/app/components/ui/forms/textarea';
import { useOrganizationId } from '@/app/hooks/use-organization-id';
import { useToast } from '@/app/hooks/use-toast';
import type { Id } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';

import { useRequestLegalHoldRelease } from '../hooks/mutations';
import { mapLegalHoldError } from './legal-hold-errors';

interface RequestReleaseDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  holdId: Id<'legalHolds'> | undefined;
}

interface FormValues {
  reason: string;
}

export function RequestReleaseDialog({
  open,
  onOpenChange,
  holdId,
}: RequestReleaseDialogProps) {
  const { t } = useT('governance');
  const { toast } = useToast();
  const organizationId = useOrganizationId();
  const { mutateAsync, isPending } = useRequestLegalHoldRelease();

  const schema = useMemo(
    () =>
      z.object({
        reason: z
          .string()
          .trim()
          .min(1, t('legalHold.errors.validation'))
          .max(2000),
      }),
    [t],
  );

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    mode: 'onChange',
    defaultValues: { reason: '' },
  });
  const { register, handleSubmit, formState, reset } = form;

  const onSubmit = handleSubmit(async (values) => {
    if (!holdId || !organizationId) return;
    try {
      await mutateAsync({
        organizationId,
        holdId,
        reason: values.reason.trim(),
      });
      toast({
        title: t('legalHold.toasts.releaseRequestedTitle'),
        description: t('legalHold.toasts.releaseRequestedDescription'),
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
      title={t('legalHold.dialogs.requestRelease.title')}
      description={t('legalHold.dialogs.requestRelease.description')}
      isSubmitting={isPending}
      isValid={formState.isValid && holdId !== undefined}
      onSubmit={onSubmit}
      submitText={t('legalHold.dialogs.requestRelease.submit')}
    >
      <FormSection>
        <Textarea
          id="release-reason"
          rows={3}
          label={t('legalHold.dialogs.requestRelease.reasonLabel')}
          required
          {...register('reason')}
          errorMessage={formState.errors.reason?.message}
        />
      </FormSection>
    </FormDialog>
  );
}
