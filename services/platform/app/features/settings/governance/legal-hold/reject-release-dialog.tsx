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

import { useRejectLegalHoldRelease } from '../hooks/mutations';
import { mapLegalHoldError } from './legal-hold-errors';

interface RejectReleaseDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  requestId: Id<'legalHoldReleaseRequests'> | undefined;
}

interface FormValues {
  reason: string;
}

export function RejectReleaseDialog({
  open,
  onOpenChange,
  requestId,
}: RejectReleaseDialogProps) {
  const { t } = useT('governance');
  const { toast } = useToast();
  const organizationId = useOrganizationId();
  const { mutateAsync, isPending } = useRejectLegalHoldRelease();

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
    if (!requestId || !organizationId) return;
    try {
      await mutateAsync({
        organizationId,
        requestId,
        reason: values.reason.trim(),
      });
      toast({
        title: t('legalHold.toasts.releaseRejectedTitle'),
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
      title={t('legalHold.dialogs.rejectRelease.title')}
      description={t('legalHold.dialogs.rejectRelease.description')}
      isSubmitting={isPending}
      isValid={formState.isValid && requestId !== undefined}
      onSubmit={onSubmit}
      submitText={t('legalHold.dialogs.rejectRelease.submit')}
    >
      <FormSection>
        <Textarea
          id="reject-release-reason"
          rows={3}
          label={t('legalHold.dialogs.rejectRelease.reasonLabel')}
          required
          {...register('reason')}
          errorMessage={formState.errors.reason?.message}
        />
      </FormSection>
    </FormDialog>
  );
}
