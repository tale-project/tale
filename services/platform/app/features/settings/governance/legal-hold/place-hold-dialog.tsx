'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import * as z from 'zod';

import { FormDialog } from '@/app/components/ui/dialog/form-dialog';
import { FormSection } from '@/app/components/ui/forms/form-section';
import { Input } from '@/app/components/ui/forms/input';
import { SearchableSelect } from '@/app/components/ui/forms/searchable-select';
import { Select } from '@/app/components/ui/forms/select';
import { Textarea } from '@/app/components/ui/forms/textarea';
import { useToast } from '@/app/hooks/use-toast';
import type { Id } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';

import { usePlaceLegalHold } from '../hooks/mutations';
import { useLegalMatters } from '../hooks/queries';
import { mapLegalHoldError } from './legal-hold-errors';
import { UpsertMatterDialog } from './upsert-matter-dialog';

const TARGET_TYPES = [
  'thread',
  'document',
  'execution',
  'userMembership',
  'org',
] as const;

type TargetType = (typeof TARGET_TYPES)[number];

interface PlaceHoldDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  /** When set, lock targetType/targetId in the form. Used by the chat /
   *  document entry points. */
  prefill?: { targetType: TargetType; targetId: string };
}

interface FormValues {
  targetType: TargetType;
  targetId: string;
  reason: string;
  matterRef: string;
}

export function PlaceHoldDialog({
  open,
  onOpenChange,
  organizationId,
  prefill,
}: PlaceHoldDialogProps) {
  const { t } = useT('governance');
  const { toast } = useToast();
  const { mutateAsync, isPending } = usePlaceLegalHold();
  const matters = useLegalMatters(organizationId, { status: 'open' });
  const [createMatterOpen, setCreateMatterOpen] = useState(false);

  const targetTypeOptions = useMemo(
    () =>
      TARGET_TYPES.map((value) => ({
        value,
        label: t(`legalHold.targetTypes.${value}`),
      })),
    [t],
  );

  const matterOptions = useMemo(
    () =>
      (matters.data ?? []).map((m) => ({
        value: String(m._id),
        label: m.name,
        description: m.caseNumber,
      })),
    [matters.data],
  );

  const schema = useMemo(
    () =>
      z.object({
        targetType: z.enum(TARGET_TYPES),
        targetId: z.string().trim().min(1, t('legalHold.errors.validation')),
        reason: z
          .string()
          .trim()
          .min(1, t('legalHold.errors.validation'))
          .max(2000),
        matterRef: z.string(),
      }),
    [t],
  );

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    mode: 'onChange',
    defaultValues: {
      targetType: prefill?.targetType ?? 'thread',
      targetId: prefill?.targetId ?? '',
      reason: '',
      matterRef: '',
    },
  });
  const { register, handleSubmit, formState, reset, watch, setValue } = form;
  const targetType = watch('targetType');
  const matterRef = watch('matterRef');

  const onSubmit = handleSubmit(async (values) => {
    try {
      await mutateAsync({
        organizationId,
        targetType: values.targetType,
        targetId: values.targetId.trim(),
        reason: values.reason.trim(),
        matterRef: values.matterRef ? values.matterRef : undefined,
      });
      toast({
        title: t('legalHold.toasts.placedTitle'),
        description: t('legalHold.toasts.placedDescription', {
          targetType: t(`legalHold.targetTypes.${values.targetType}`),
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
    <>
      <FormDialog
        open={open}
        onOpenChange={handleOpenChange}
        title={t('legalHold.dialogs.placeHold.title')}
        description={t('legalHold.dialogs.placeHold.description')}
        isSubmitting={isPending}
        isValid={formState.isValid}
        onSubmit={onSubmit}
        submitText={t('legalHold.dialogs.placeHold.submit')}
      >
        <FormSection>
          <Select
            id="hold-target-type"
            label={t('legalHold.dialogs.placeHold.targetTypeLabel')}
            value={targetType}
            onValueChange={(value) =>
              // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Select onValueChange yields string; options are constrained to TargetType
              setValue('targetType', value as TargetType, {
                shouldDirty: true,
                shouldValidate: true,
              })
            }
            options={targetTypeOptions}
            disabled={prefill !== undefined}
          />
          <Input
            id="hold-target-id"
            label={t('legalHold.dialogs.placeHold.targetIdLabel')}
            required
            disabled={prefill !== undefined}
            {...register('targetId')}
            errorMessage={formState.errors.targetId?.message}
          />
          <Textarea
            id="hold-reason"
            rows={3}
            label={t('legalHold.dialogs.placeHold.reasonLabel')}
            placeholder={t('legalHold.dialogs.placeHold.reasonPlaceholder')}
            required
            {...register('reason')}
            errorMessage={formState.errors.reason?.message}
          />
          <SearchableSelect
            id="hold-matter"
            label={t('legalHold.dialogs.placeHold.matterLabel')}
            placeholder={t('legalHold.dialogs.placeHold.matterPlaceholder')}
            value={matterRef || null}
            onValueChange={(value) =>
              setValue('matterRef', value, { shouldDirty: true })
            }
            options={matterOptions}
            footer={
              <button
                type="button"
                className="text-primary hover:bg-accent w-full px-3 py-2 text-left text-sm"
                onClick={() => setCreateMatterOpen(true)}
              >
                {t('legalHold.dialogs.placeHold.matterCreateNew')}
              </button>
            }
          />
        </FormSection>
      </FormDialog>
      <UpsertMatterDialog
        open={createMatterOpen}
        onOpenChange={setCreateMatterOpen}
        organizationId={organizationId}
        onSuccess={(matterId: Id<'legalMatters'>) =>
          setValue('matterRef', String(matterId), {
            shouldDirty: true,
            shouldValidate: true,
          })
        }
      />
    </>
  );
}
