'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMemo } from 'react';
import { useForm } from 'react-hook-form';
import * as z from 'zod';

import { FormDialog } from '@/app/components/ui/dialog/form-dialog';
import { FormSection } from '@/app/components/ui/forms/form-section';
import { Input } from '@/app/components/ui/forms/input';
import { Textarea } from '@/app/components/ui/forms/textarea';
import { useToast } from '@/app/hooks/use-toast';
import type { Id } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';

import { useUpsertLegalMatter } from '../hooks/mutations';
import { mapLegalHoldError } from './legal-hold-errors';

interface UpsertMatterDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  /** When set the dialog edits an existing matter; omit to create. */
  matter?: {
    _id: Id<'legalMatters'>;
    name: string;
    caseNumber?: string;
    description?: string;
  };
  onSuccess?: (matterId: Id<'legalMatters'>) => void;
}

interface FormValues {
  name: string;
  caseNumber: string;
  description: string;
}

export function UpsertMatterDialog({
  open,
  onOpenChange,
  organizationId,
  matter,
  onSuccess,
}: UpsertMatterDialogProps) {
  const { t } = useT('governance');
  const { toast } = useToast();
  const isEdit = matter !== undefined;
  const { mutateAsync, isPending } = useUpsertLegalMatter();

  const schema = useMemo(
    () =>
      z.object({
        name: z.string().trim().min(1, t('legalHold.errors.validation')),
        caseNumber: z.string().trim().max(200),
        description: z.string().trim().max(2000),
      }),
    [t],
  );

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    mode: 'onChange',
    defaultValues: {
      name: matter?.name ?? '',
      caseNumber: matter?.caseNumber ?? '',
      description: matter?.description ?? '',
    },
  });
  const { register, handleSubmit, formState, reset } = form;

  const onSubmit = handleSubmit(async (values) => {
    try {
      const matterId = await mutateAsync({
        organizationId,
        matterId: matter?._id,
        name: values.name.trim(),
        caseNumber: values.caseNumber.trim() || undefined,
        description: values.description.trim() || undefined,
      });
      toast({
        title: isEdit
          ? t('legalHold.toasts.matterUpdatedTitle')
          : t('legalHold.toasts.matterCreatedTitle'),
        variant: 'success',
      });
      onSuccess?.(matterId);
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
      title={
        isEdit
          ? t('legalHold.dialogs.upsertMatter.editTitle')
          : t('legalHold.dialogs.upsertMatter.createTitle')
      }
      description={t('legalHold.dialogs.upsertMatter.description')}
      isSubmitting={isPending}
      isValid={formState.isValid}
      onSubmit={onSubmit}
      submitText={
        isEdit
          ? t('legalHold.dialogs.upsertMatter.submitEdit')
          : t('legalHold.dialogs.upsertMatter.submitCreate')
      }
    >
      <FormSection>
        <Input
          id="matter-name"
          label={t('legalHold.dialogs.upsertMatter.nameLabel')}
          placeholder={t('legalHold.dialogs.upsertMatter.namePlaceholder')}
          required
          {...register('name')}
          errorMessage={formState.errors.name?.message}
        />
        <Input
          id="matter-case-number"
          label={t('legalHold.dialogs.upsertMatter.caseNumberLabel')}
          {...register('caseNumber')}
          errorMessage={formState.errors.caseNumber?.message}
        />
        <Textarea
          id="matter-description"
          rows={3}
          aria-label={t('legalHold.dialogs.upsertMatter.descriptionLabel')}
          placeholder={t('legalHold.dialogs.upsertMatter.descriptionLabel')}
          {...register('description')}
        />
      </FormSection>
    </FormDialog>
  );
}
